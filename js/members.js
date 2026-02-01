// Members module - handles member CRUD operations

const Members = {
    // Fetch all members for a group, sorted by points descending
    async getAll(groupId) {
        const snapshot = await db.collection('members')
            .where('groupId', '==', groupId)
            .orderBy('points', 'desc')
            .get();

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    },

    // Get a single member by ID
    async get(memberId) {
        const doc = await db.collection('members').doc(memberId).get();
        if (!doc.exists) return null;
        return { id: doc.id, ...doc.data() };
    },

    // Add a new member to a group
    async add(groupId, name) {
        const memberData = {
            groupId,
            name: name.trim(),
            points: 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('members').add(memberData);

        // Log to history
        await History.log(groupId, {
            action: 'member_added',
            memberName: name.trim(),
            points: 0
        });

        return { id: docRef.id, ...memberData };
    },

    // Remove a member
    async remove(memberId) {
        const member = await this.get(memberId);
        if (!member) return false;

        await db.collection('members').doc(memberId).delete();
        return true;
    },

    // Update member points
    async updatePoints(memberId, pointsDelta, note = null) {
        const member = await this.get(memberId);
        if (!member) return null;

        const newPoints = member.points + pointsDelta;

        await db.collection('members').doc(memberId).update({
            points: newPoints
        });

        // Log adjustment to history
        await History.log(member.groupId, {
            action: 'points_adjusted',
            memberName: member.name,
            points: pointsDelta,
            note
        });

        return { ...member, points: newPoints };
    },

    // Add points from completing a task (no separate history log, task completion logs it)
    async addPointsFromTask(memberId, points) {
        const member = await this.get(memberId);
        if (!member) return null;

        const newPoints = member.points + points;

        await db.collection('members').doc(memberId).update({
            points: newPoints
        });

        return { ...member, points: newPoints };
    },

    // Render leaderboard
    renderLeaderboard(members, containerId) {
        const container = document.getElementById(containerId);

        if (!members || members.length === 0) {
            container.innerHTML = '<p class="empty-state">No members yet</p>';
            return;
        }

        container.innerHTML = members.map((member, index) => `
            <div class="leaderboard-item">
                <div class="leaderboard-rank">${index + 1}</div>
                <div class="leaderboard-name">${this.escapeHtml(member.name)}</div>
                <div class="leaderboard-points">${member.points} pts</div>
            </div>
        `).join('');
    },

    // Render member dropdown
    renderDropdown(members, selectId, selectedId = null) {
        const select = document.getElementById(selectId);
        const firstOption = select.options[0];

        select.innerHTML = '';
        select.appendChild(firstOption);

        members.forEach(member => {
            const option = document.createElement('option');
            option.value = member.id;
            option.textContent = `${member.name} (${member.points} pts)`;
            if (member.id === selectedId) option.selected = true;
            select.appendChild(option);
        });
    },

    // Render admin members list
    renderAdminList(members, containerId) {
        const container = document.getElementById(containerId);

        if (!members || members.length === 0) {
            container.innerHTML = '<p class="empty-state">No members</p>';
            return;
        }

        container.innerHTML = members.map(member => `
            <div class="admin-list-item">
                <div class="admin-list-item-info">
                    <div class="admin-list-item-name">${this.escapeHtml(member.name)}</div>
                    <div class="admin-list-item-meta">${member.points} points</div>
                </div>
                <div class="admin-list-item-actions">
                    <button class="btn btn-small btn-danger" onclick="App.removeMember('${member.id}')">Remove</button>
                </div>
            </div>
        `).join('');
    },

    // Utility: escape HTML to prevent XSS
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
