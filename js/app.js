// Main app logic - routing, group management, event handlers

const App = {
    currentGroupId: null,
    currentGroup: null,
    currentMemberId: null,
    members: [],
    tasks: [],

    // Initialize the app
    async init() {
        this.bindEvents();
        this.checkExistingGroup();
    },

    // Check if user has a group stored in localStorage
    async checkExistingGroup() {
        const groupId = localStorage.getItem('bummer_group_id');
        if (groupId) {
            try {
                const group = await this.getGroup(groupId);
                if (group) {
                    this.currentGroupId = groupId;
                    this.currentGroup = group;
                    this.currentMemberId = localStorage.getItem('bummer_member_id');
                    await this.showDashboard();
                    return;
                }
            } catch (e) {
                console.error('Error loading group:', e);
            }
            // Group not found, clear storage
            localStorage.removeItem('bummer_group_id');
            localStorage.removeItem('bummer_member_id');
        }
        this.showView('landing-view');
    },

    // Get group by ID
    async getGroup(groupId) {
        const doc = await db.collection('groups').doc(groupId).get();
        if (!doc.exists) return null;
        return { id: doc.id, ...doc.data() };
    },

    // Get group by code
    async getGroupByCode(code) {
        const snapshot = await db.collection('groups')
            .where('code', '==', code.toUpperCase())
            .limit(1)
            .get();

        if (snapshot.empty) return null;
        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() };
    },

    // Create a new group
    async createGroup(name, adminPin) {
        const code = generateGroupCode();

        const groupData = {
            name: name.trim(),
            code,
            adminPin,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('groups').add(groupData);

        return { id: docRef.id, ...groupData };
    },

    // Show a specific view
    showView(viewId) {
        document.querySelectorAll('.view').forEach(view => {
            view.classList.add('hidden');
        });
        document.getElementById(viewId).classList.remove('hidden');
    },

    // Show dashboard
    async showDashboard() {
        this.showView('dashboard-view');
        document.getElementById('group-title').textContent = this.currentGroup.name;

        await this.refreshData();
    },

    // Refresh all data
    async refreshData() {
        try {
            // Load members
            this.members = await Members.getAll(this.currentGroupId);
            Members.renderLeaderboard(this.members, 'leaderboard');
            Members.renderDropdown(this.members, 'current-member', this.currentMemberId);

            // Load tasks
            this.tasks = await Tasks.getUpcoming(this.currentGroupId);
            await Tasks.renderTasksList(this.tasks, 'tasks-list', this.currentMemberId, this.members);

            // Load history
            const history = await History.getRecent(this.currentGroupId);
            History.renderHistoryList(history, 'history-list');
        } catch (e) {
            console.error('Error refreshing data:', e);
            showToast('Error loading data', 'error');
        }
    },

    // Refresh admin data
    async refreshAdminData() {
        try {
            this.members = await Members.getAll(this.currentGroupId);
            Members.renderAdminList(this.members, 'admin-members-list');
            Members.renderDropdown(this.members, 'adjust-member');

            const allTasks = await Tasks.getAll(this.currentGroupId);
            Tasks.renderAdminList(allTasks, 'admin-tasks-list');

            document.getElementById('display-group-code').textContent = this.currentGroup.code;
            document.getElementById('new-group-name').value = this.currentGroup.name;
        } catch (e) {
            console.error('Error refreshing admin data:', e);
        }
    },

    // Bind all event handlers
    bindEvents() {
        // Create group form
        document.getElementById('create-group-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('group-name').value;
            const pin = document.getElementById('admin-pin').value;

            if (pin.length !== 4 || !/^\d+$/.test(pin)) {
                showToast('PIN must be 4 digits', 'error');
                return;
            }

            try {
                const group = await this.createGroup(name, pin);
                this.currentGroupId = group.id;
                this.currentGroup = group;
                localStorage.setItem('bummer_group_id', group.id);
                showToast('Group created!', 'success');
                await this.showDashboard();
            } catch (e) {
                console.error('Error creating group:', e);
                showToast('Error creating group', 'error');
            }
        });

        // Join group form
        document.getElementById('join-group-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const code = document.getElementById('group-code').value.trim().toUpperCase();

            try {
                const group = await this.getGroupByCode(code);
                if (!group) {
                    showToast('Group not found', 'error');
                    return;
                }

                this.currentGroupId = group.id;
                this.currentGroup = group;
                localStorage.setItem('bummer_group_id', group.id);
                showToast('Joined group!', 'success');
                await this.showDashboard();
            } catch (e) {
                console.error('Error joining group:', e);
                showToast('Error joining group', 'error');
            }
        });

        // Member selection
        document.getElementById('current-member').addEventListener('change', (e) => {
            this.currentMemberId = e.target.value || null;
            if (this.currentMemberId) {
                localStorage.setItem('bummer_member_id', this.currentMemberId);
            } else {
                localStorage.removeItem('bummer_member_id');
            }
            Tasks.renderTasksList(this.tasks, 'tasks-list', this.currentMemberId, this.members);
        });

        // Admin button
        document.getElementById('admin-btn').addEventListener('click', () => {
            this.showPinModal();
        });

        // Leave button
        document.getElementById('leave-btn').addEventListener('click', () => {
            if (confirm('Log out of this group?')) {
                localStorage.removeItem('bummer_group_id');
                localStorage.removeItem('bummer_member_id');
                sessionStorage.removeItem('bummer_admin_verified');
                this.currentGroupId = null;
                this.currentGroup = null;
                this.currentMemberId = null;
                this.showView('landing-view');
            }
        });

        // Admin back button
        document.getElementById('admin-back-btn').addEventListener('click', async () => {
            await this.showDashboard();
        });

        // Tab switching
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabId = e.target.dataset.tab;
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                e.target.classList.add('active');
                document.getElementById(tabId).classList.add('active');
            });
        });

        // PIN modal
        document.getElementById('pin-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const pin = document.getElementById('pin-input').value;

            if (pin === this.currentGroup.adminPin) {
                sessionStorage.setItem('bummer_admin_verified', 'true');
                this.hidePinModal();
                this.showView('admin-view');
                await this.refreshAdminData();
            } else {
                document.getElementById('pin-error').classList.remove('hidden');
            }
        });

        document.getElementById('pin-cancel').addEventListener('click', () => {
            this.hidePinModal();
        });

        // Add member form
        document.getElementById('add-member-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('new-member-name').value;

            try {
                await Members.add(this.currentGroupId, name);
                document.getElementById('new-member-name').value = '';
                showToast('Member added!', 'success');
                await this.refreshAdminData();
            } catch (e) {
                console.error('Error adding member:', e);
                showToast('Error adding member', 'error');
            }
        });

        // Adjust points form
        document.getElementById('adjust-points-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const memberId = document.getElementById('adjust-member').value;
            const amount = parseInt(document.getElementById('adjust-amount').value, 10);
            const note = document.getElementById('adjust-note').value;

            if (!memberId) {
                showToast('Select a member', 'error');
                return;
            }

            try {
                await Members.updatePoints(memberId, amount, note || null);
                document.getElementById('adjust-amount').value = '';
                document.getElementById('adjust-note').value = '';
                showToast('Points adjusted!', 'success');
                await this.refreshAdminData();
            } catch (e) {
                console.error('Error adjusting points:', e);
                showToast('Error adjusting points', 'error');
            }
        });

        // Create task form
        document.getElementById('task-recurring').addEventListener('change', (e) => {
            document.getElementById('frequency-group').style.display = e.target.checked ? 'block' : 'none';
        });

        document.getElementById('create-task-form').addEventListener('submit', async (e) => {
            e.preventDefault();

            const taskData = {
                name: document.getElementById('task-name').value,
                description: document.getElementById('task-description').value,
                points: document.getElementById('task-points').value,
                dueDate: document.getElementById('task-due-date').value,
                isRecurring: document.getElementById('task-recurring').checked,
                frequency: document.getElementById('task-frequency').value
            };

            try {
                await Tasks.create(this.currentGroupId, taskData);
                e.target.reset();
                document.getElementById('frequency-group').style.display = 'none';
                showToast('Task created!', 'success');
                await this.refreshAdminData();
            } catch (e) {
                console.error('Error creating task:', e);
                showToast('Error creating task', 'error');
            }
        });

        // Rename group form
        document.getElementById('rename-group-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const newName = document.getElementById('new-group-name').value.trim();

            try {
                await db.collection('groups').doc(this.currentGroupId).update({ name: newName });
                this.currentGroup.name = newName;
                showToast('Group renamed!', 'success');
            } catch (e) {
                console.error('Error renaming group:', e);
                showToast('Error renaming group', 'error');
            }
        });

        // Copy code button
        document.getElementById('copy-code-btn').addEventListener('click', () => {
            navigator.clipboard.writeText(this.currentGroup.code).then(() => {
                showToast('Code copied!', 'success');
            });
        });

        // Edit task modal
        document.getElementById('edit-task-cancel').addEventListener('click', () => {
            document.getElementById('edit-task-modal').classList.add('hidden');
        });

        document.getElementById('edit-task-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const taskId = document.getElementById('edit-task-id').value;

            const updates = {
                name: document.getElementById('edit-task-name').value,
                description: document.getElementById('edit-task-description').value,
                points: parseInt(document.getElementById('edit-task-points').value, 10),
                dueDate: document.getElementById('edit-task-due-date').value
            };

            try {
                await Tasks.update(taskId, updates);
                document.getElementById('edit-task-modal').classList.add('hidden');
                showToast('Task updated!', 'success');
                await this.refreshAdminData();
            } catch (e) {
                console.error('Error updating task:', e);
                showToast('Error updating task', 'error');
            }
        });
    },

    // Show PIN modal
    showPinModal() {
        // Check if already verified this session
        if (sessionStorage.getItem('bummer_admin_verified') === 'true') {
            this.showView('admin-view');
            this.refreshAdminData();
            return;
        }

        document.getElementById('pin-input').value = '';
        document.getElementById('pin-error').classList.add('hidden');
        document.getElementById('pin-modal').classList.remove('hidden');
    },

    // Hide PIN modal
    hidePinModal() {
        document.getElementById('pin-modal').classList.add('hidden');
    },

    // Claim a task
    async claimTask(taskId) {
        if (!this.currentMemberId) {
            showToast('Select yourself first', 'error');
            return;
        }

        try {
            const result = await Tasks.claim(taskId, this.currentMemberId);
            if (result.success) {
                showToast('Task claimed!', 'success');
                await this.refreshData();
            } else {
                showToast(result.error, 'error');
            }
        } catch (e) {
            console.error('Error claiming task:', e);
            showToast('Error claiming task', 'error');
        }
    },

    // Complete a task
    async completeTask(taskId) {
        if (!this.currentMemberId) {
            showToast('Select yourself first', 'error');
            return;
        }

        try {
            const result = await Tasks.complete(taskId, this.currentMemberId);
            if (result.success) {
                showToast(`Task completed! +${result.points} pts`, 'success');
                await this.refreshData();
            } else {
                showToast(result.error, 'error');
            }
        } catch (e) {
            console.error('Error completing task:', e);
            showToast('Error completing task', 'error');
        }
    },

    // Remove a member (admin)
    async removeMember(memberId) {
        if (!confirm('Remove this member?')) return;

        try {
            await Members.remove(memberId);
            showToast('Member removed', 'success');
            await this.refreshAdminData();
        } catch (e) {
            console.error('Error removing member:', e);
            showToast('Error removing member', 'error');
        }
    },

    // Edit a task (admin)
    async editTask(taskId) {
        try {
            const task = await Tasks.get(taskId);
            if (!task) {
                showToast('Task not found', 'error');
                return;
            }

            document.getElementById('edit-task-id').value = task.id;
            document.getElementById('edit-task-name').value = task.name;
            document.getElementById('edit-task-description').value = task.description || '';
            document.getElementById('edit-task-points').value = task.points;

            const dueDate = task.dueDate.toDate();
            document.getElementById('edit-task-due-date').value = dueDate.toISOString().split('T')[0];

            document.getElementById('edit-task-modal').classList.remove('hidden');
        } catch (e) {
            console.error('Error loading task:', e);
            showToast('Error loading task', 'error');
        }
    },

    // Delete a task (admin)
    async deleteTask(taskId) {
        if (!confirm('Delete this task?')) return;

        try {
            await Tasks.delete(taskId);
            showToast('Task deleted', 'success');
            await this.refreshAdminData();
        } catch (e) {
            console.error('Error deleting task:', e);
            showToast('Error deleting task', 'error');
        }
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
