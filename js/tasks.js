// Tasks module - handles task CRUD and claiming/completing

const Tasks = {
    // Fetch upcoming tasks (available and claimed) for a group
    async getUpcoming(groupId) {
        const snapshot = await db.collection('tasks')
            .where('groupId', '==', groupId)
            .where('status', 'in', ['available', 'claimed'])
            .orderBy('dueDate', 'asc')
            .get();

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    },

    // Fetch all tasks for admin view
    async getAll(groupId) {
        const snapshot = await db.collection('tasks')
            .where('groupId', '==', groupId)
            .orderBy('dueDate', 'asc')
            .get();

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    },

    // Get a single task
    async get(taskId) {
        const doc = await db.collection('tasks').doc(taskId).get();
        if (!doc.exists) return null;
        return { id: doc.id, ...doc.data() };
    },

    // Create a new task
    async create(groupId, taskData) {
        const task = {
            groupId,
            name: taskData.name.trim(),
            description: taskData.description?.trim() || '',
            points: parseInt(taskData.points, 10),
            isRecurring: taskData.isRecurring || false,
            frequency: taskData.isRecurring ? taskData.frequency : null,
            dueDate: firebase.firestore.Timestamp.fromDate(new Date(taskData.dueDate)),
            status: 'available',
            claimedBy: null,
            claimedAt: null,
            completedBy: null,
            completedAt: null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('tasks').add(task);

        // Log to history
        await History.log(groupId, {
            action: 'task_created',
            taskName: task.name,
            memberName: 'Admin',
            points: task.points
        });

        return { id: docRef.id, ...task };
    },

    // Update a task
    async update(taskId, updates) {
        const updateData = { ...updates };

        if (updates.dueDate && typeof updates.dueDate === 'string') {
            updateData.dueDate = firebase.firestore.Timestamp.fromDate(new Date(updates.dueDate));
        }

        await db.collection('tasks').doc(taskId).update(updateData);
        return this.get(taskId);
    },

    // Delete a task
    async delete(taskId) {
        await db.collection('tasks').doc(taskId).delete();
        return true;
    },

    // Claim a task
    async claim(taskId, memberId) {
        const task = await this.get(taskId);
        if (!task || task.status !== 'available') {
            return { success: false, error: 'Task is no longer available' };
        }

        const member = await Members.get(memberId);
        if (!member) {
            return { success: false, error: 'Member not found' };
        }

        // Check for conflicting claims (lowest points wins)
        // In a real app, you'd use a transaction here
        const members = await Members.getAll(task.groupId);
        const claimingMember = members.find(m => m.id === memberId);

        // For simplicity, we just proceed with the claim
        // A more robust implementation would use Firestore transactions

        await db.collection('tasks').doc(taskId).update({
            status: 'claimed',
            claimedBy: memberId,
            claimedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, memberName: member.name };
    },

    // Complete a task
    async complete(taskId, memberId) {
        const task = await this.get(taskId);
        if (!task) {
            return { success: false, error: 'Task not found' };
        }

        if (task.status !== 'claimed' || task.claimedBy !== memberId) {
            return { success: false, error: 'You can only complete tasks you have claimed' };
        }

        const member = await Members.get(memberId);
        if (!member) {
            return { success: false, error: 'Member not found' };
        }

        // Update task status
        await db.collection('tasks').doc(taskId).update({
            status: 'completed',
            completedBy: memberId,
            completedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Award points to member
        await Members.addPointsFromTask(memberId, task.points);

        // Log to history
        await History.log(task.groupId, {
            action: 'task_completed',
            taskName: task.name,
            memberName: member.name,
            points: task.points
        });

        // If recurring, create next instance
        if (task.isRecurring && task.frequency) {
            await this.createNextRecurrence(task);
        }

        return { success: true, points: task.points };
    },

    // Create next recurrence of a recurring task
    async createNextRecurrence(task) {
        const currentDue = task.dueDate.toDate();
        let nextDue = new Date(currentDue);

        switch (task.frequency) {
            case 'daily':
                nextDue.setDate(nextDue.getDate() + 1);
                break;
            case 'weekly':
                nextDue.setDate(nextDue.getDate() + 7);
                break;
            case 'biweekly':
                nextDue.setDate(nextDue.getDate() + 14);
                break;
            case 'monthly':
                nextDue.setMonth(nextDue.getMonth() + 1);
                break;
        }

        const newTask = {
            groupId: task.groupId,
            name: task.name,
            description: task.description,
            points: task.points,
            isRecurring: true,
            frequency: task.frequency,
            dueDate: firebase.firestore.Timestamp.fromDate(nextDue),
            status: 'available',
            claimedBy: null,
            claimedAt: null,
            completedBy: null,
            completedAt: null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('tasks').add(newTask);
    },

    // Group tasks by due date category
    groupTasksByDueDate(tasks) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dayAfterTomorrow = new Date(today);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);

        const groups = {
            overdue: [],
            today: [],
            tomorrow: [],
            thisWeek: [],
            later: [],
            noDueDate: []
        };

        tasks.forEach(task => {
            if (!task.dueDate) {
                groups.noDueDate.push(task);
                return;
            }

            const dueDate = task.dueDate.toDate();
            const dueDateStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

            if (dueDateStart < today) {
                groups.overdue.push(task);
            } else if (dueDateStart.getTime() === today.getTime()) {
                groups.today.push(task);
            } else if (dueDateStart.getTime() === tomorrow.getTime()) {
                groups.tomorrow.push(task);
            } else if (dueDateStart < nextWeek) {
                groups.thisWeek.push(task);
            } else {
                groups.later.push(task);
            }
        });

        return groups;
    },

    // Render a single task item
    renderTaskItem(task, memberMap, currentMemberId, isOverdue) {
        const dueDate = task.dueDate ? task.dueDate.toDate() : null;
        const dueDateStr = dueDate ? this.formatDate(dueDate) : 'No due date';

        let statusClass = isOverdue ? 'overdue' : '';
        let actions = '';
        let claimedInfo = '';

        if (task.status === 'available') {
            if (currentMemberId) {
                actions = `<button class="btn btn-primary btn-small" onclick="App.claimTask('${task.id}')">Claim</button>`;
            }
        } else if (task.status === 'claimed') {
            statusClass += (statusClass ? ' ' : '') + 'claimed';
            const claimerName = memberMap[task.claimedBy] || 'Unknown';
            claimedInfo = `<span class="task-claimed-by">Claimed by ${this.escapeHtml(claimerName)}</span>`;

            if (task.claimedBy === currentMemberId) {
                actions = `<button class="btn btn-primary btn-small" onclick="App.completeTask('${task.id}')">Complete</button>`;
            }
        }

        return `
            <div class="task-item ${statusClass}">
                <div class="task-header">
                    <span class="task-name">${this.escapeHtml(task.name)}</span>
                    <span class="task-points">${task.points} pts</span>
                </div>
                ${task.description ? `<div class="task-description">${this.escapeHtml(task.description)}</div>` : ''}
                <div class="task-meta">
                    <span class="task-due ${isOverdue ? 'overdue' : ''}">
                        ${isOverdue ? 'Overdue: ' : 'Due: '}${dueDateStr}
                        ${task.isRecurring ? ` (${task.frequency})` : ''}
                    </span>
                    ${claimedInfo}
                </div>
                ${actions ? `<div class="task-actions">${actions}</div>` : ''}
            </div>
        `;
    },

    // Render tasks list grouped by due date
    async renderTasksList(tasks, containerId, currentMemberId, members) {
        const container = document.getElementById(containerId);

        if (!tasks || tasks.length === 0) {
            container.innerHTML = '<p class="empty-state">No upcoming tasks</p>';
            return;
        }

        // Build member lookup
        const memberMap = {};
        members.forEach(m => memberMap[m.id] = m.name);

        // Group tasks by due date
        const groups = this.groupTasksByDueDate(tasks);

        const sections = [
            { key: 'overdue', label: 'Overdue', isOverdue: true },
            { key: 'today', label: 'Due Today', isOverdue: false },
            { key: 'tomorrow', label: 'Due Tomorrow', isOverdue: false },
            { key: 'thisWeek', label: 'Due This Week', isOverdue: false },
            { key: 'later', label: 'Due Later', isOverdue: false },
            { key: 'noDueDate', label: 'No Due Date', isOverdue: false }
        ];

        let html = '';

        sections.forEach(section => {
            const sectionTasks = groups[section.key];
            if (sectionTasks.length === 0) return;

            const sectionClass = section.isOverdue ? 'task-section task-section-overdue' : 'task-section';
            html += `<div class="${sectionClass}">`;
            html += `<div class="task-section-header">${section.label}</div>`;
            html += sectionTasks.map(task =>
                this.renderTaskItem(task, memberMap, currentMemberId, section.isOverdue)
            ).join('');
            html += '</div>';
        });

        container.innerHTML = html;
    },

    // Render admin tasks list
    renderAdminList(tasks, containerId) {
        const container = document.getElementById(containerId);

        if (!tasks || tasks.length === 0) {
            container.innerHTML = '<p class="empty-state">No tasks</p>';
            return;
        }

        container.innerHTML = tasks.map(task => {
            const dueDate = task.dueDate.toDate();
            const dueDateStr = this.formatDate(dueDate);

            return `
                <div class="admin-list-item">
                    <div class="admin-list-item-info">
                        <div class="admin-list-item-name">${this.escapeHtml(task.name)}</div>
                        <div class="admin-list-item-meta">
                            ${task.points} pts | Due: ${dueDateStr} | ${task.status}
                            ${task.isRecurring ? ` | ${task.frequency}` : ''}
                        </div>
                    </div>
                    <div class="admin-list-item-actions">
                        <button class="btn btn-small btn-secondary" onclick="App.editTask('${task.id}')">Edit</button>
                        <button class="btn btn-small btn-danger" onclick="App.deleteTask('${task.id}')">Delete</button>
                    </div>
                </div>
            `;
        }).join('');
    },

    // Format date for display
    formatDate(date) {
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        if (date.toDateString() === today.toDateString()) {
            return 'Today';
        } else if (date.toDateString() === tomorrow.toDateString()) {
            return 'Tomorrow';
        } else {
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            });
        }
    },

    // Utility: escape HTML
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
