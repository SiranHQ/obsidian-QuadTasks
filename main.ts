import { Plugin, MarkdownPostProcessorContext, TFile, Modal, App, MarkdownRenderChild, setIcon, debounce, MarkdownRenderer } from "obsidian";

interface EisenhowerTask {
    id: string;
    category: string;
    text: string;
    completed: boolean;
}

interface MatrixState {
    focusedQuadrant: string | null;
    showBuffer: boolean;
}

const QUADRANTS = [
    { id: "urgent-important", label: "Do First", class: "q-urgent-important" },
    { id: "not-urgent-important", label: "Schedule", class: "q-not-urgent-important" },
    { id: "urgent-not-important", label: "Delegate", class: "q-urgent-not-important" },
    { id: "not-urgent-not-important", label: "Eliminate", class: "q-not-urgent-not-important" }
];

export default class EisenhowerMatrixPlugin extends Plugin {
    viewStateCache: Map<string, MatrixState> = new Map();

    async onload() {
        const aliases = ["eisenhower", "eisen", "todoeh"];
        aliases.forEach(alias => {
            this.registerMarkdownCodeBlockProcessor(alias, (source, el, ctx) => {
                const processor = new MatrixRenderChild(el, source, ctx, this.app, this);
                ctx.addChild(processor);
            });
        });
    }
}

class MatrixRenderChild extends MarkdownRenderChild {
    tasks: EisenhowerTask[] = [];
    otherLines: string[] = [];
    source: string;
    ctx: MarkdownPostProcessorContext;
    app: App;
    plugin: EisenhowerMatrixPlugin;
    
    debouncedSave: () => void;
    draggedTask: EisenhowerTask | null = null;
    dragIndicator: HTMLElement | null = null;
    
    constructor(containerEl: HTMLElement, source: string, ctx: MarkdownPostProcessorContext, app: App, plugin: EisenhowerMatrixPlugin) {
        super(containerEl);
        this.source = source;
        this.ctx = ctx;
        this.app = app;
        this.plugin = plugin;
        this.debouncedSave = debounce(this.saveChanges.bind(this), 500, true);
    }

    get state(): MatrixState {
        return this.plugin.viewStateCache.get(this.ctx.sourcePath) || { focusedQuadrant: null, showBuffer: false };
    }

    updateState(updates: Partial<MatrixState>) {
        const current = this.state;
        this.plugin.viewStateCache.set(this.ctx.sourcePath, { ...current, ...updates });
        this.render();
    }

    onload() {
        this.parseSource();
        
        if (!this.plugin.viewStateCache.has(this.ctx.sourcePath)) {
            const hasBufferTasks = this.tasks.some(t => t.category === "buffer");
            this.plugin.viewStateCache.set(this.ctx.sourcePath, { 
                focusedQuadrant: null, 
                showBuffer: hasBufferTasks 
            });
        }
        this.render();
    }

    parseSource() {
        const lines = this.source.split('\n');
        this.tasks = [];
        this.otherLines = [];
        
        const taskRegex = /^\s*-\s+\[(.)\]\s*\(([^)]+)\)\s*(.+)/;

        lines.forEach(line => {
            const match = line.match(taskRegex);
            if (match) {
                this.tasks.push({
                    id: Math.random().toString(36).substring(2, 11),
                    completed: match[1].toLowerCase() === 'x',
                    category: match[2].trim(),
                    text: match[3].trim()
                });
            } else if (line.trim().length > 0) {
                this.otherLines.push(line);
            }
        });
    }

    render() {
        this.containerEl.empty();
        
        const wrapper = this.containerEl.createDiv({ cls: "eisenhower-wrapper" });
        const { focusedQuadrant, showBuffer } = this.state;

        const grid = wrapper.createDiv({ 
            cls: `eisenhower-grid ${focusedQuadrant ? 'focus-mode' : ''}` 
        });

        QUADRANTS.forEach(q => {
            if (focusedQuadrant && focusedQuadrant !== q.id) return;

            const quadEl = grid.createDiv({ cls: `eisenhower-quad ${q.class}` });
            const header = quadEl.createDiv({ cls: "quad-header" });
            header.createSpan({ text: q.label, cls: "quad-title" });

            const focusBtn = header.createEl("button", { cls: "quad-focus-btn" });
            setIcon(focusBtn, focusedQuadrant === q.id ? "minimize-2" : "maximize-2");
            focusBtn.setAttribute("aria-label", focusedQuadrant === q.id ? "Exit focus mode" : "Focus on this quadrant");
            
            focusBtn.onclick = () => {
                this.updateState({ focusedQuadrant: focusedQuadrant === q.id ? null : q.id });
            };

            const listEl = quadEl.createEl("ul", { cls: "task-list" });
            listEl.dataset.category = q.id;

            const quadTasks = this.tasks.filter(t => t.category === q.id);
            if (quadTasks.length === 0) {
                const empty = listEl.createDiv({ cls: "empty-message" });
                empty.createSpan({ text: "No tasks" });
            }

            quadTasks.forEach(task => this.renderTaskItem(task, listEl));
            this.setupDropZone(listEl);
        });

        if (showBuffer && !focusedQuadrant) {
            const bufferEl = wrapper.createDiv({ cls: "eisenhower-buffer" });
            
            const header = bufferEl.createDiv({ cls: "buffer-header" });
            header.createSpan({ text: "Inbox/Buffer", cls: "buffer-title" });
            
            const listEl = bufferEl.createEl("ul", { cls: "task-list" });
            listEl.dataset.category = "buffer"; 

            const bufferTasks = this.tasks.filter(t => t.category === "buffer");
            if (bufferTasks.length === 0) {
                const empty = listEl.createDiv({ cls: "empty-message" });
                empty.createSpan({ text: "Inbox empty" });
            }

            bufferTasks.forEach(task => this.renderTaskItem(task, listEl));
            this.setupDropZone(listEl);
        }

        const footer = wrapper.createDiv({ cls: "matrix-footer" });
        
        const addBtn = footer.createEl("button", { cls: "matrix-btn add-task-btn" });
        const addIcon = addBtn.createSpan({ cls: "btn-icon" });
        setIcon(addIcon, "plus");
        addBtn.createSpan({ text: "Add task", cls: "btn-text" });
        addBtn.onclick = () => this.openTaskModal();

        if (!focusedQuadrant) {
            const inboxBtn = footer.createEl("button", { 
                cls: `matrix-btn inbox-btn ${showBuffer ? 'is-active' : ''}` 
            });
            const inboxIcon = inboxBtn.createSpan({ cls: "btn-icon" });
            setIcon(inboxIcon, "inbox");
            
            const bufferCount = this.tasks.filter(t => t.category === "buffer" && !t.completed).length;
            const btnText = showBuffer ? "Hide Inbox" : (bufferCount > 0 ? `Inbox (${bufferCount})` : "Inbox");
            
            inboxBtn.createSpan({ text: btnText, cls: "btn-text" });
            
            if (!showBuffer && bufferCount > 0) {
                inboxBtn.addClass("has-items");
            }

            inboxBtn.onclick = () => {
                this.updateState({ showBuffer: !showBuffer });
            };
        }

        const hasCompleted = this.tasks.some(t => t.completed);
        if (hasCompleted) {
            const clearBtn = footer.createEl("button", { cls: "matrix-btn clear-btn" });
            const clearIcon = clearBtn.createSpan({ cls: "btn-icon" });
            setIcon(clearIcon, "trash-2");
            clearBtn.createSpan({ text: "Clear completed", cls: "btn-text" });
            clearBtn.onclick = () => this.clearCompleted();
        }
    }

    renderTaskItem(task: EisenhowerTask, container: HTMLElement) {
        const li = container.createEl("li", { 
            cls: `task-item ${task.completed ? 'is-completed' : ''}` 
        });
        li.draggable = true;
        li.dataset.id = task.id;
        
        const checkbox = li.createEl("input", { 
            type: "checkbox", 
            cls: "task-checkbox" 
        });
        checkbox.checked = task.completed;
        
        checkbox.onclick = (e) => {
            e.stopPropagation();
            task.completed = !task.completed;
            this.render();
            this.debouncedSave();
        };

        checkbox.ondragstart = (e) => {
             e.preventDefault();
             e.stopPropagation();
        };

        const textDiv = li.createDiv({ cls: "task-text" });
        MarkdownRenderer.renderMarkdown(task.text, textDiv, this.ctx.sourcePath, this);

        const delBtn = li.createEl("button", { cls: "task-delete-btn" });
        setIcon(delBtn, "x");
        
        delBtn.onclick = (e) => {
            e.stopPropagation();
            this.deleteTask(task.id);
        };
        
        li.addEventListener("dragstart", (e) => {
            if (e.target instanceof HTMLAnchorElement) {
                e.preventDefault();
                return;
            }

            this.draggedTask = task;
            li.classList.add("dragging");
            e.dataTransfer?.setData("text/plain", JSON.stringify(task));
            e.dataTransfer!.effectAllowed = "move";
        });

        li.addEventListener("dragend", () => {
            li.classList.remove("dragging");
            this.draggedTask = null;
            this.removeDragIndicator();
        });
    }

    setupDropZone(listEl: HTMLElement) {
        listEl.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (!this.draggedTask) return;
            e.dataTransfer!.dropEffect = "move";
            const afterElement = this.getDragAfterElement(listEl, e.clientY);
            this.updateDragIndicator(listEl, afterElement);
        });

        listEl.addEventListener("dragleave", (e) => {
            if (!listEl.contains(e.relatedTarget as Node)) {
                this.removeDragIndicator();
            }
        });

        listEl.addEventListener("drop", (e) => {
            e.preventDefault();
            this.removeDragIndicator();
            if (!this.draggedTask) return;

            const targetCategory = listEl.dataset.category!;
            const afterElement = this.getDragAfterElement(listEl, e.clientY);
            
            this.tasks = this.tasks.filter(t => t.id !== this.draggedTask!.id);
            this.draggedTask.category = targetCategory;

            if (afterElement == null) {
                this.tasks.push(this.draggedTask);
            } else {
                const afterId = (afterElement as HTMLElement).dataset.id;
                const index = this.tasks.findIndex(t => t.id === afterId);
                this.tasks.splice(index, 0, this.draggedTask);
            }

            // ISSUE #1 FIX: Only auto-show buffer if we explicitly dropped INTO the buffer
            // Otherwise, keep user's preference
            if (targetCategory === "buffer") {
                this.updateState({ showBuffer: true });
            } else {
                this.render();
            }
            
            this.debouncedSave();
        });
    }

    getDragAfterElement(container: HTMLElement, y: number) {
        const draggableElements = [...container.querySelectorAll('.task-item:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY, element: null as Element | null }).element;
    }

    updateDragIndicator(container: HTMLElement, afterElement: Element | null) {
        this.removeDragIndicator();
        this.dragIndicator = document.createElement('div');
        this.dragIndicator.className = 'drag-indicator';
        if (afterElement) {
            container.insertBefore(this.dragIndicator, afterElement);
        } else {
            container.appendChild(this.dragIndicator);
        }
    }

    removeDragIndicator() {
        if (this.dragIndicator) {
            this.dragIndicator.remove();
            this.dragIndicator = null;
        }
    }

    openTaskModal() {
        const showBuffer = this.state.showBuffer;
        
        new CreateTaskModal(this.app, showBuffer, (result) => {
            this.tasks.push({
                id: Math.random().toString(36).substring(2, 11),
                completed: false,
                category: result.category,
                text: result.text
            });
            
            if (result.category === "buffer") {
                this.updateState({ showBuffer: true });
            } else {
                this.render();
            }
            
            this.debouncedSave();
        }).open();
    }

    deleteTask(id: string) {
        this.tasks = this.tasks.filter(t => t.id !== id);
        this.render();
        this.debouncedSave();
    }

    clearCompleted() {
        this.tasks = this.tasks.filter(t => !t.completed);
        this.render();
        this.debouncedSave();
    }

    async saveChanges() {
        const file = this.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
        if (!(file instanceof TFile)) return;

        const taskLines = this.tasks.map(t => `- [${t.completed ? 'x' : ' '}] (${t.category}) ${t.text}`);
        const newContent = [...this.otherLines, ...taskLines].join('\n');
        
        const fileContent = await this.app.vault.read(file);
        const updatedFileContent = fileContent.replace(
            /```(eisenhower|eisen|todoeh)[\s\S]*?```/, 
            (match, alias) => `\`\`\`${alias}\n${newContent}\n\`\`\``
        );

        await this.app.vault.modify(file, updatedFileContent);
    }
}

class CreateTaskModal extends Modal {
    onSubmit: (result: { text: string; category: string }) => void;
    showBuffer: boolean;

    constructor(app: App, showBuffer: boolean, onSubmit: (result: { text: string; category: string }) => void) {
        super(app);
        this.onSubmit = onSubmit;
        this.showBuffer = showBuffer;
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        modalEl.addClass("eisenhower-modal");
        contentEl.empty();

        const header = contentEl.createDiv({ cls: "modal-header" });
        header.createEl("h3", { text: "Add new task" });

        const form = contentEl.createDiv({ cls: "modal-form" });
        
        const inputGroup = form.createDiv({ cls: "input-group" });
        inputGroup.createEl("label", { text: "Task description" });
        const input = inputGroup.createEl("input", { 
            type: "text", 
            cls: "modal-input",
            placeholder: "Enter task description (supports [[links]] and #tags)"
        });

        const categoryGroup = form.createDiv({ cls: "category-group" });
        categoryGroup.createEl("label", { text: "Priority" });
        
        const optionsContainer = categoryGroup.createDiv({ cls: "category-options" });
        
        // Default to buffer if visible, else Urgent/Important
        let selectedCategory = this.showBuffer ? "buffer" : "urgent-important";
        
        const categories = [
            { id: "buffer", label: "Inbox", desc: "Decide later" },
            { id: "urgent-important", label: "Do First", desc: "Urgent & Important" },
            { id: "not-urgent-important", label: "Schedule", desc: "Important, not urgent" },
            { id: "urgent-not-important", label: "Delegate", desc: "Urgent, not important" },
            { id: "not-urgent-not-important", label: "Eliminate", desc: "Neither urgent nor important" }
        ];

        const options: HTMLElement[] = [];

        categories.forEach(cat => {
            const option = optionsContainer.createDiv({ 
                cls: `category-option ${cat.id === selectedCategory ? 'selected' : ''}` 
            });
            option.dataset.category = cat.id;
            
            const radio = option.createEl("input", { 
                type: "radio",
                cls: "category-radio"
            });
            radio.checked = cat.id === selectedCategory;
            
            const labelDiv = option.createDiv({ cls: "category-label" });
            labelDiv.createDiv({ text: cat.label, cls: "category-name" });
            labelDiv.createDiv({ text: cat.desc, cls: "category-desc" });
            
            option.onclick = () => {
                selectedCategory = cat.id;
                options.forEach(opt => {
                    opt.removeClass('selected');
                    (opt.querySelector('.category-radio') as HTMLInputElement).checked = false;
                });
                option.addClass('selected');
                radio.checked = true;
            };
            
            options.push(option);
        });

        const actions = contentEl.createDiv({ cls: "modal-actions" });
        
        const cancelBtn = actions.createEl("button", { 
            text: "Cancel", 
            cls: "modal-btn modal-btn-secondary" 
        });
        cancelBtn.onclick = () => this.close();
        
        const submitBtn = actions.createEl("button", { 
            text: "Add task", 
            cls: "modal-btn modal-btn-primary" 
        });

        const submit = () => {
            const value = input.value.trim();
            if (value) {
                this.onSubmit({ text: value, category: selectedCategory });
                this.close();
            }
        };

        submitBtn.onclick = submit;
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") this.close();
        });

        setTimeout(() => input.focus(), 50);
    }

    onClose() {
        this.contentEl.empty();
    }
}

