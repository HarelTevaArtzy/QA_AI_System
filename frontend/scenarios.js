(function () {
    const form = document.getElementById("scenario-form");
    const formTitle = document.getElementById("scenario-form-title");
    const idInput = document.getElementById("scenario-id");
    const titleInput = document.getElementById("scenario-title");
    const descriptionInput = document.getElementById("scenario-description");
    const stepsInput = document.getElementById("scenario-steps");
    const expectedInput = document.getElementById("scenario-expected");
    const priorityInput = document.getElementById("scenario-priority");
    const statusNode = document.getElementById("scenario-status");
    const listNode = document.getElementById("scenario-list");
    const countNode = document.getElementById("scenario-list-count");
    const metricNode = document.getElementById("scenario-count");
    const resetButton = document.getElementById("scenario-reset");
    const exportExcelButton = document.getElementById("export-excel");
    const exportWordButton = document.getElementById("export-word");
    const refreshLibraryButton = document.getElementById("scenario-refresh");
    const panelNode = document.querySelector(".panel-scenarios");
    const panelToggleButton = document.getElementById("scenario-panel-toggle");

    const state = {
        editingId: null,
        scenarios: [],
    };

    function setStatus(message, isError = false) {
        statusNode.textContent = message;
        statusNode.style.color = isError ? "#8e1b12" : "";
    }

    function escapeHtml(value) {
        return value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function formatLines(value) {
        const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
        if (!lines.length) {
            return "<p>-</p>";
        }
        return `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
    }

    function formatDate(value) {
        return new Date(value).toLocaleString();
    }

    function updateCounts() {
        const count = state.scenarios.length;
        countNode.textContent = `${count} item${count === 1 ? "" : "s"}`;
        metricNode.textContent = String(count);
    }

    function setCollapsedState(container, button, isCollapsed) {
        if (!(container instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) {
            return;
        }
        container.classList.toggle("is-collapsed", isCollapsed);
        container.classList.toggle("is-expanded", !isCollapsed);
        button.setAttribute("aria-expanded", String(!isCollapsed));

        const label = button.querySelector(".collapse-toggle-label");
        const icon = button.querySelector(".collapse-toggle-icon");
        if (label) {
            label.textContent = isCollapsed ? "Expand" : "Collapse";
        }
        if (icon) {
            icon.textContent = isCollapsed ? "+" : "-";
        }
    }

    function renderScenarios() {
        updateCounts();
        if (!state.scenarios.length) {
            listNode.innerHTML = '<div class="empty-state">No scenarios yet. Create one to start building the QA library.</div>';
            return;
        }

        listNode.innerHTML = state.scenarios
            .map((scenario) => `
                <article class="scenario-item">
                    <div class="scenario-head">
                        <div>
                            <h4>${escapeHtml(scenario.title)}</h4>
                            <p class="topic-meta">${formatDate(scenario.created_at)}</p>
                        </div>
                        <span class="priority priority-${escapeHtml(scenario.priority)}">${escapeHtml(scenario.priority)}</span>
                    </div>
                    <div class="scenario-body">
                        <p>${escapeHtml(scenario.description || "No description provided.")}</p>
                        <div>
                            <span class="scenario-section-title">Test Steps</span>
                            ${formatLines(scenario.steps)}
                        </div>
                        <div>
                            <span class="scenario-section-title">Expected Results</span>
                            ${formatLines(scenario.expected_result)}
                        </div>
                    </div>
                    <div class="item-actions">
                        <button type="button" class="ghost-button small" data-action="edit" data-id="${scenario.id}">Edit</button>
                        <button type="button" class="ghost-button small" data-action="delete" data-id="${scenario.id}">Delete</button>
                    </div>
                </article>
            `)
            .join("");
    }

    function resetForm() {
        state.editingId = null;
        idInput.value = "";
        form.reset();
        priorityInput.value = "medium";
        formTitle.textContent = "Create Scenario";
        setStatus("");
    }

    function populateForm(scenario) {
        state.editingId = scenario.id;
        idInput.value = String(scenario.id);
        titleInput.value = scenario.title;
        descriptionInput.value = scenario.description;
        stepsInput.value = scenario.steps;
        expectedInput.value = scenario.expected_result;
        priorityInput.value = scenario.priority;
        formTitle.textContent = "Edit Scenario";
        setStatus(`Editing scenario #${scenario.id}`);
        window.scrollTo({top: 0, behavior: "smooth"});
    }

    async function loadScenarios() {
        try {
            const response = await fetch("/scenarios");
            if (!response.ok) {
                throw new Error("Unable to load scenarios.");
            }
            state.scenarios = await response.json();
            renderScenarios();
        } catch (error) {
            setStatus(error.message || "Unable to load scenarios.", true);
        }
    }

    async function saveScenario(event) {
        event.preventDefault();
        setStatus("Saving scenario...");

        const payload = {
            title: titleInput.value,
            description: descriptionInput.value,
            steps: stepsInput.value,
            expected_result: expectedInput.value,
            priority: priorityInput.value,
        };
        const isEditing = Boolean(state.editingId);
        const url = isEditing ? `/scenarios/${state.editingId}` : "/scenarios";
        const method = isEditing ? "PUT" : "POST";

        try {
            const response = await fetch(url, {
                method,
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const problem = await response.json().catch(() => ({}));
                throw new Error(problem.detail || "Unable to save scenario.");
            }
            await loadScenarios();
            resetForm();
            setStatus(isEditing ? "Scenario updated." : "Scenario created.");
        } catch (error) {
            setStatus(error.message || "Unable to save scenario.", true);
        }
    }

    async function deleteScenario(id) {
        const approved = window.confirm("Delete this scenario?");
        if (!approved) {
            return;
        }

        setStatus("Deleting scenario...");
        try {
            const response = await fetch(`/scenarios/${id}`, {method: "DELETE"});
            if (!response.ok) {
                throw new Error("Unable to delete scenario.");
            }
            if (state.editingId === id) {
                resetForm();
            }
            await loadScenarios();
            setStatus("Scenario deleted.");
        } catch (error) {
            setStatus(error.message || "Unable to delete scenario.", true);
        }
    }

    listNode.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const action = target.dataset.action;
        const id = Number(target.dataset.id);
        if (!action || !id) {
            return;
        }
        const scenario = state.scenarios.find((item) => item.id === id);
        if (!scenario) {
            return;
        }
        if (action === "edit") {
            populateForm(scenario);
        }
        if (action === "delete") {
            deleteScenario(id);
        }
    });

    exportExcelButton.addEventListener("click", () => {
        window.open("/export/scenarios/excel", "_blank", "noopener");
    });

    exportWordButton.addEventListener("click", () => {
        window.open("/export/scenarios/word", "_blank", "noopener");
    });

    refreshLibraryButton?.addEventListener("click", async () => {
        setStatus("Refreshing scenarios...");
        await loadScenarios();
        setStatus("Scenario library refreshed.");
    });

    panelToggleButton?.addEventListener("click", () => {
        if (!(panelNode instanceof HTMLElement)) {
            return;
        }
        const isCollapsed = !panelNode.classList.contains("is-collapsed");
        setCollapsedState(panelNode, panelToggleButton, isCollapsed);
    });

    form.addEventListener("submit", saveScenario);
    resetButton.addEventListener("click", resetForm);
    setCollapsedState(panelNode, panelToggleButton, true);
    loadScenarios();
})();
