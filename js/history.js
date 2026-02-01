// History module - handles activity logging

const History = {
    // Log an event
    async log(groupId, eventData) {
        const entry = {
            groupId,
            action: eventData.action,
            taskName: eventData.taskName || null,
            memberName: eventData.memberName,
            points: eventData.points || 0,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            note: eventData.note || null
        };

        await db.collection('history').add(entry);
        return entry;
    },

    // Fetch recent history for a group
    async getRecent(groupId, limit = 20) {
        const snapshot = await db.collection('history')
            .where('groupId', '==', groupId)
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    },

    // Render history list
    renderHistoryList(history, containerId) {
        const container = document.getElementById(containerId);

        if (!history || history.length === 0) {
            container.innerHTML = '<p class="empty-state">No activity yet</p>';
            return;
        }

        container.innerHTML = history.map(item => {
            let actionText = '';
            let pointsClass = '';
            let pointsText = '';

            switch (item.action) {
                case 'task_completed':
                    actionText = `${this.escapeHtml(item.memberName)} completed "${this.escapeHtml(item.taskName)}"`;
                    pointsText = `+${item.points}`;
                    break;
                case 'points_adjusted':
                    actionText = `${this.escapeHtml(item.memberName)}'s points adjusted`;
                    if (item.note) {
                        actionText += `: ${this.escapeHtml(item.note)}`;
                    }
                    pointsText = item.points >= 0 ? `+${item.points}` : `${item.points}`;
                    pointsClass = item.points < 0 ? 'negative' : '';
                    break;
                case 'member_added':
                    actionText = `${this.escapeHtml(item.memberName)} joined the group`;
                    break;
                case 'task_created':
                    actionText = `Task "${this.escapeHtml(item.taskName)}" created (${item.points} pts)`;
                    break;
                default:
                    actionText = item.action;
            }

            const timeStr = item.timestamp ? this.formatTime(item.timestamp.toDate()) : '';

            return `
                <div class="history-item">
                    <div class="history-item-header">
                        <span class="history-action">${actionText}</span>
                        ${pointsText ? `<span class="history-points ${pointsClass}">${pointsText}</span>` : ''}
                    </div>
                    <div class="history-time">${timeStr}</div>
                </div>
            `;
        }).join('');
    },

    // Format timestamp for display
    formatTime(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) {
            return 'Just now';
        } else if (diffMins < 60) {
            return `${diffMins}m ago`;
        } else if (diffHours < 24) {
            return `${diffHours}h ago`;
        } else if (diffDays < 7) {
            return `${diffDays}d ago`;
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
