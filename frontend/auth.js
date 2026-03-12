(function () {
    const DEFAULT_API_BASE_URL = "https://qa-ai-system-1.onrender.com";
    const apiBaseMetaTag = document.querySelector('meta[name="qa-api-base-url"]');
    const hasApiBaseMetaTag = Boolean(apiBaseMetaTag);
    const metaApiBaseUrl = hasApiBaseMetaTag
        ? (apiBaseMetaTag.getAttribute("content") || "").trim()
        : "";
    const runtimeApiBaseUrl = typeof window.__QA_API_BASE_URL__ === "string"
        ? window.__QA_API_BASE_URL__.trim()
        : "";
    const API_BASE_URL = (runtimeApiBaseUrl || (hasApiBaseMetaTag ? metaApiBaseUrl : DEFAULT_API_BASE_URL))
        .replace(/\/+$/, "");
    const storageKey = "qa-system-auth";
    const defaultPanelId = "requirements-panel";
    const loginForm = document.getElementById("login-form");
    const loginUsernameInput = document.getElementById("login-username");
    const loginPasswordInput = document.getElementById("login-password");
    const authStatus = document.getElementById("auth-status");
    const authRolePill = document.getElementById("auth-role-pill");
    const sessionView = document.getElementById("session-view");
    const currentUserName = document.getElementById("current-user-name");
    const currentUserRole = document.getElementById("current-user-role");
    const logoutButton = document.getElementById("logout-button");
    const workspaceTabs = document.getElementById("workspace-tabs");
    const workspaceGrid = document.getElementById("workspace-grid");
    const userPanel = document.getElementById("user-panel");
    const userTabButton = document.getElementById("user-tab-button");
    const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]"));
    const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));
    const userForm = document.getElementById("user-form");
    const userFormTitle = document.getElementById("user-form-title");
    const userIdInput = document.getElementById("user-id");
    const userUsernameInput = document.getElementById("user-username");
    const userPasswordInput = document.getElementById("user-password");
    const userRoleInput = document.getElementById("user-role");
    const userStatus = document.getElementById("user-status");
    const userList = document.getElementById("user-list");
    const userListCount = document.getElementById("user-list-count");
    const userResetButton = document.getElementById("user-reset");
    const userRefreshButton = document.getElementById("user-refresh");

    const state = {
        token: null,
        user: null,
        users: [],
        editingUserId: null,
        activePanelId: defaultPanelId,
    };

    function readStoredAuth() {
        try {
            return JSON.parse(window.localStorage.getItem(storageKey) || "null");
        } catch (_error) {
            return null;
        }
    }

    function persistAuth() {
        if (!state.token || !state.user) {
            window.localStorage.removeItem(storageKey);
            return;
        }
        window.localStorage.setItem(storageKey, JSON.stringify({
            token: state.token,
            user: state.user,
        }));
    }

    function setAuthStatus(message, isError = false) {
        authStatus.textContent = message;
        authStatus.style.color = isError ? "#8e1b12" : "";
    }

    function setUserStatus(message, isError = false) {
        userStatus.textContent = message;
        userStatus.style.color = isError ? "#8e1b12" : "";
    }

    function formatProblemDetail(detail, fallbackMessage) {
        if (typeof detail === "string" && detail.trim()) {
            return detail;
        }
        if (Array.isArray(detail) && detail.length) {
            const first = detail[0];
            if (typeof first === "string" && first.trim()) {
                return first;
            }
            if (first && typeof first === "object") {
                const location = Array.isArray(first.loc) ? first.loc.join(" -> ") : "";
                const message = typeof first.msg === "string" ? first.msg : fallbackMessage;
                return location ? `${location}: ${message}` : message;
            }
        }
        return fallbackMessage;
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function isAuthenticated() {
        return Boolean(state.token && state.user);
    }

    function hasRole(...roles) {
        return Boolean(state.user && roles.includes(state.user.role));
    }

    function canWriteContent() {
        return hasRole("admin", "qa");
    }

    function canManageUsers() {
        return hasRole("admin");
    }

    function getVisibleTabButtons() {
        return tabButtons.filter((button) => !button.classList.contains("hidden"));
    }

    function setActivePanel(panelId) {
        state.activePanelId = panelId;
        tabButtons.forEach((button) => {
            button.classList.toggle("is-active", button.dataset.tabTarget === panelId);
        });
        tabPanels.forEach((panel) => {
            panel.classList.toggle("hidden", panel.id !== panelId);
        });
    }

    function ensureActivePanel() {
        const visibleTabs = getVisibleTabButtons();
        if (!visibleTabs.length) {
            tabPanels.forEach((panel) => panel.classList.add("hidden"));
            return;
        }

        const target = visibleTabs.some((button) => button.dataset.tabTarget === state.activePanelId)
            ? state.activePanelId
            : visibleTabs[0].dataset.tabTarget;
        setActivePanel(target);
    }

    function broadcastAuthChange() {
        window.dispatchEvent(new CustomEvent("qa:auth-changed", {
            detail: {
                user: state.user,
                token: state.token,
            },
        }));
    }

    function updateUserPanelVisibility() {
        const show = canManageUsers();
        userTabButton?.classList.toggle("hidden", !show);
        userPanel?.classList.toggle("hidden", !show && state.activePanelId === "user-panel");
        ensureActivePanel();
    }

    function renderSession() {
        const signedIn = isAuthenticated();
        loginForm?.classList.toggle("hidden", signedIn);
        sessionView?.classList.toggle("hidden", !signedIn);
        workspaceTabs?.classList.toggle("hidden", !signedIn);
        workspaceGrid?.classList.toggle("hidden", !signedIn);
        if (!signedIn) {
            authRolePill.textContent = "Signed out";
            currentUserName.textContent = "-";
            currentUserRole.textContent = "Authenticate to access QA content.";
            tabPanels.forEach((panel) => panel.classList.add("hidden"));
            return;
        }

        authRolePill.textContent = state.user.role.toUpperCase();
        currentUserName.textContent = state.user.username;
        currentUserRole.textContent = `Role: ${state.user.role}`;
        ensureActivePanel();
    }

    function renderUsers() {
        const count = state.users.length;
        userListCount.textContent = `${count} user${count === 1 ? "" : "s"}`;

        if (!canManageUsers()) {
            userList.innerHTML = '<div class="empty-state">Admin users can manage accounts here.</div>';
            return;
        }

        if (!count) {
            userList.innerHTML = '<div class="empty-state">No users found.</div>';
            return;
        }

        userList.innerHTML = state.users.map((user) => `
            <article class="scenario-item">
                <div class="scenario-head">
                    <div>
                        <h4>${escapeHtml(user.username)}</h4>
                        <p class="topic-meta">${new Date(user.created_at).toLocaleString()}</p>
                    </div>
                    <span class="priority priority-${user.role === "admin" ? "critical" : user.role === "qa" ? "high" : "low"}">${escapeHtml(user.role)}</span>
                </div>
                <div class="item-actions">
                    <button type="button" class="ghost-button small" data-user-action="edit" data-id="${user.id}">Edit</button>
                    <button type="button" class="ghost-button small" data-user-action="delete" data-id="${user.id}">Delete</button>
                </div>
            </article>
        `).join("");
    }

    function resetUserForm() {
        state.editingUserId = null;
        userIdInput.value = "";
        userFormTitle.textContent = "Create User";
        userForm.reset();
        userRoleInput.value = "viewer";
        setUserStatus("");
    }

    function populateUserForm(user) {
        state.editingUserId = user.id;
        userIdInput.value = String(user.id);
        userUsernameInput.value = user.username;
        userPasswordInput.value = "";
        userRoleInput.value = user.role;
        userFormTitle.textContent = "Edit User";
        setUserStatus(`Editing user ${user.username}. Leave password blank to keep the current value.`);
        setActivePanel("user-panel");
        window.scrollTo({top: 0, behavior: "smooth"});
    }

    function clearAuthState(message = "") {
        state.token = null;
        state.user = null;
        state.users = [];
        state.editingUserId = null;
        state.activePanelId = defaultPanelId;
        persistAuth();
        renderSession();
        renderUsers();
        updateUserPanelVisibility();
        if (message) {
            setAuthStatus(message);
        }
        broadcastAuthChange();
    }

    function resolveApiUrl(path) {
        if (typeof path !== "string" || !path) {
            return path;
        }
        if (/^https?:\/\//i.test(path)) {
            return path;
        }
        return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
    }

    async function apiFetch(url, options = {}) {
        const headers = new Headers(options.headers || {});
        if (state.token && !headers.has("Authorization")) {
            headers.set("Authorization", `Bearer ${state.token}`);
        }
        const response = await fetch(resolveApiUrl(url), {...options, headers});
        if (response.status === 401 && state.token) {
            clearAuthState("Your session expired. Sign in again.");
        }
        return response;
    }

    async function loadCurrentUser() {
        if (!state.token) {
            return;
        }
        try {
            const response = await apiFetch("/auth/me");
            if (!response.ok) {
                if (response.status === 401) {
                    return;
                }
                throw new Error("Unable to validate your session.");
            }
            state.user = await response.json();
            persistAuth();
            renderSession();
            updateUserPanelVisibility();
            broadcastAuthChange();
            if (canManageUsers()) {
                await loadUsers();
            }
        } catch (error) {
            clearAuthState(error.message || "Unable to validate your session.");
        }
    }

    async function loadUsers() {
        if (!canManageUsers()) {
            renderUsers();
            return;
        }
        try {
            const response = await apiFetch("/users");
            if (!response.ok) {
                throw new Error("Unable to load users.");
            }
            state.users = await response.json();
            renderUsers();
        } catch (error) {
            setUserStatus(error.message || "Unable to load users.", true);
        }
    }

    async function signIn(event) {
        event.preventDefault();
        setAuthStatus("Signing in...");
        try {
            const response = await fetch(resolveApiUrl("/auth/login"), {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    username: loginUsernameInput.value,
                    password: loginPasswordInput.value,
                }),
            });
            if (!response.ok) {
                const problem = await response.json().catch(() => ({}));
                throw new Error(problem.detail || "Unable to sign in.");
            }
            const payload = await response.json();
            state.token = payload.access_token;
            state.user = payload.user;
            state.activePanelId = defaultPanelId;
            persistAuth();
            loginForm.reset();
            renderSession();
            updateUserPanelVisibility();
            setAuthStatus("Signed in.");
            broadcastAuthChange();
            if (canManageUsers()) {
                await loadUsers();
            } else {
                renderUsers();
            }
        } catch (error) {
            setAuthStatus(error.message || "Unable to sign in.", true);
        }
    }

    async function signOut() {
        try {
            await apiFetch("/auth/logout", {method: "POST"});
        } finally {
            clearAuthState("Signed out.");
        }
    }

    async function saveUser(event) {
        event.preventDefault();
        if (!canManageUsers()) {
            setUserStatus("Only admins can manage users.", true);
            return;
        }

        const isEditing = Boolean(state.editingUserId);
        const payload = {
            username: userUsernameInput.value,
            role: userRoleInput.value,
        };
        if (userPasswordInput.value || !isEditing) {
            payload.password = userPasswordInput.value;
        }

        setUserStatus(isEditing ? "Updating user..." : "Creating user...");
        try {
            const response = await apiFetch(isEditing ? `/users/${state.editingUserId}` : "/users", {
                method: isEditing ? "PUT" : "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const problem = await response.json().catch(() => ({}));
                throw new Error(formatProblemDetail(problem.detail, "Unable to save user."));
            }
            await loadUsers();
            resetUserForm();
            setUserStatus(isEditing ? "User updated." : "User created.");
        } catch (error) {
            setUserStatus(error.message || "Unable to save user.", true);
        }
    }

    async function deleteUser(id) {
        if (!window.confirm("Delete this user?")) {
            return;
        }

        setUserStatus("Deleting user...");
        try {
            const response = await apiFetch(`/users/${id}`, {method: "DELETE"});
            if (!response.ok) {
                const problem = await response.json().catch(() => ({}));
                throw new Error(problem.detail || "Unable to delete user.");
            }
            if (state.editingUserId === id) {
                resetUserForm();
            }
            await loadUsers();
            setUserStatus("User deleted.");
        } catch (error) {
            setUserStatus(error.message || "Unable to delete user.", true);
        }
    }

    tabButtons.forEach((button) => {
        button.addEventListener("click", () => {
            if (button.classList.contains("hidden")) {
                return;
            }
            setActivePanel(button.dataset.tabTarget);
        });
    });

    userList?.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const action = target.dataset.userAction;
        const id = Number(target.dataset.id);
        if (!action || !id) {
            return;
        }
        const user = state.users.find((item) => item.id === id);
        if (!user) {
            return;
        }
        if (action === "edit") {
            populateUserForm(user);
        }
        if (action === "delete") {
            await deleteUser(id);
        }
    });

    userRefreshButton?.addEventListener("click", loadUsers);
    userResetButton?.addEventListener("click", resetUserForm);
    userForm?.addEventListener("submit", saveUser);
    loginForm?.addEventListener("submit", signIn);
    logoutButton?.addEventListener("click", signOut);

    window.addEventListener("qa:tab-select-request", (event) => {
        const requestedPanel = event.detail?.panelId;
        if (!requestedPanel || !isAuthenticated()) {
            return;
        }
        const targetButton = tabButtons.find((button) => button.dataset.tabTarget === requestedPanel);
        if (!targetButton || targetButton.classList.contains("hidden")) {
            return;
        }
        setActivePanel(requestedPanel);
    });

    const stored = readStoredAuth();
    if (stored?.token) {
        state.token = stored.token;
        state.user = stored.user || null;
    }

    renderSession();
    renderUsers();
    updateUserPanelVisibility();

    window.qaApi = {
        fetch: apiFetch,
    };
    window.qaAuth = {
        getUser: () => state.user,
        isAuthenticated,
        hasRole,
        canWriteContent,
        canManageUsers,
    };

    if (state.token) {
        loadCurrentUser();
    } else {
        broadcastAuthChange();
    }
})();
