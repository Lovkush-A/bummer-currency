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
            frequencyInterval: taskData.isRecurring ? parseInt(taskData.frequencyInterval, 10) : null,
            frequencyUnit: taskData.isRecurring ? taskData.frequencyUnit : null,
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

    // Claim a task (or claim from someone with more points)
    async claim(taskId, memberId, claimFromMemberId = null) {
        const task = await this.get(taskId);
        if (!task) {
            return { success: false, error: 'Task not found' };
        }

        // If task is already claimed by someone else, verify the claimer can take it
        if (task.status === 'claimed' && task.claimedBy !== memberId) {
            if (!claimFromMemberId || task.claimedBy !== claimFromMemberId) {
                return { success: false, error: 'Task is already claimed' };
            }
            // claimFromMemberId matches - this is a competitive claim, verified by caller
        } else if (task.status !== 'available' && task.status !== 'claimed') {
            return { success: false, error: 'Task is no longer available' };
        }

        const member = await Members.get(memberId);
        if (!member) {
            return { success: false, error: 'Member not found' };
        }

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
        if (task.isRecurring && task.frequencyInterval) {
            await this.createNextRecurrence(task);
        }

        return { success: true, points: task.points };
    },

    // Create next recurrence of a recurring task
    async createNextRecurrence(task) {
        const currentDue = task.dueDate.toDate();
        let nextDue = new Date(currentDue);

        const interval = task.frequencyInterval;
        switch (task.frequencyUnit) {
            case 'days':
                nextDue.setDate(nextDue.getDate() + interval);
                break;
            case 'weeks':
                nextDue.setDate(nextDue.getDate() + (interval * 7));
                break;
            case 'months':
                nextDue.setMonth(nextDue.getMonth() + interval);
                break;
        }

        const newTask = {
            groupId: task.groupId,
            name: task.name,
            description: task.description,
            points: task.points,
            isRecurring: true,
            frequencyInterval: task.frequencyInterval,
            frequencyUnit: task.frequencyUnit,
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
    renderTaskItem(task, memberMap, memberPointsMap, currentMemberId, isOverdue) {
        const dueDate = task.dueDate ? task.dueDate.toDate() : null;
        const dueDateStr = dueDate ? this.formatDate(dueDate) : 'No due date';

        let statusClass = isOverdue ? 'overdue' : '';
        let actions = '';
        let claimedInfo = '';

        const currentMemberPoints = currentMemberId ? (memberPointsMap[currentMemberId] || 0) : 0;

        if (task.status === 'available') {
            if (currentMemberId) {
                actions = `<button class="btn btn-primary btn-small" onclick="App.claimTask('${task.id}')">Claim</button>`;
            }
        } else if (task.status === 'claimed') {
            statusClass += (statusClass ? ' ' : '') + 'claimed';
            const claimerName = memberMap[task.claimedBy] || 'Unknown';
            const claimerPoints = memberPointsMap[task.claimedBy] || 0;

            if (task.claimedBy === currentMemberId) {
                // You claimed it - show Complete button
                claimedInfo = `<span class="task-claimed-by">Claimed by you</span>`;
                actions = `<button class="btn btn-primary btn-small" onclick="App.completeTask('${task.id}')">Complete</button>`;
            } else if (currentMemberId && currentMemberPoints < claimerPoints) {
                // You have fewer points - can claim from them
                claimedInfo = `<span class="task-claimed-by task-can-claim">You have fewer points than ${this.escapeHtml(claimerName)}</span>`;
                actions = `<button class="btn btn-secondary btn-small" onclick="App.claimFromTask('${task.id}', '${task.claimedBy}', '${this.escapeHtml(claimerName).replace(/'/g, "\\'")}')">Claim from ${this.escapeHtml(claimerName)}</button>`;
            } else {
                // They have fewer or equal points - cannot claim
                claimedInfo = `<span class="task-claimed-by">Claimed by ${this.escapeHtml(claimerName)} (fewer points)</span>`;
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
                        ${task.isRecurring ? ` (${this.formatFrequency(task)})` : ''}
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

        // Build member lookups (name and points)
        const memberMap = {};
        const memberPointsMap = {};
        members.forEach(m => {
            memberMap[m.id] = m.name;
            memberPointsMap[m.id] = m.points || 0;
        });

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
                this.renderTaskItem(task, memberMap, memberPointsMap, currentMemberId, section.isOverdue)
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
                            ${task.isRecurring ? ` | ${this.formatFrequency(task)}` : ''}
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

    // Format frequency for display
    formatFrequency(task) {
        if (!task.frequencyInterval || !task.frequencyUnit) return '';
        const interval = task.frequencyInterval;
        const unit = task.frequencyUnit;
        if (interval === 1) {
            // Singular: "every day", "every week", "every month"
            const singular = unit.slice(0, -1); // Remove 's'
            return `every ${singular}`;
        }
        return `every ${interval} ${unit}`;
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
