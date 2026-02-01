# Bummer Currency - Project Context

## Overview

Bummer Currency is a web app for fairly distributing unpleasant tasks (chores) among group members using a points-based system. It's inspired by the [Putanumonit blog post](https://putanumonit.com/2016/04/02/021_bummer/) where the author describes a "bummer points" system used in military service to incentivize volunteers for undesirable tasks.

## The Original Concept

From the blog: Tasks are assigned point values based on undesirability (e.g., cleaning toilets = 5 points, 3 AM patrol = 8 points). Members volunteer for tasks and earn points. When multiple people volunteer, the person with the lowest total points gets priority. If no one volunteers, the person with the fewest accumulated points is assigned the task. This creates a self-balancing system where work is distributed fairly over time.

## Tech Stack

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **Backend**: Firebase (Firestore database, Hosting)
- **Deployment**: Firebase Hosting
- **Version Control**: GitHub

## Project Structure

```
bummer-currency/
├── index.html              # Main SPA HTML
├── firebase.json           # Firebase hosting config
├── firestore.rules         # Firestore security rules (currently open for dev)
├── firestore.indexes.json  # Composite indexes for queries
├── .firebaserc             # Firebase project reference
├── css/
│   └── style.css          # All styling (~650 lines)
└── js/
    ├── app.js             # Main app logic & routing
    ├── firebase-config.js # Firebase setup & utilities
    ├── members.js         # Member CRUD operations
    ├── tasks.js           # Task management (including recurrence)
    └── history.js         # Activity logging
```

## Firebase Project

- **Project ID**: `bummer-currency`
- **Hosting**: Firebase Hosting
- **Database**: Cloud Firestore

## Data Model

### Collections

**groups**
- `name`, `code` (shareable like "HOUSE-7K3M"), `adminPin` (4-digit), `createdAt`

**members**
- `groupId`, `name`, `points`, `createdAt`

**tasks**
- `groupId`, `name`, `description`, `points`, `status` (available/claimed/completed)
- `dueDate`, `claimedBy`, `completedBy`, `isRecurring`, `frequency`

**history**
- `groupId`, `action`, `taskName`, `memberName`, `points`, `timestamp`, `note`

## Key Features

### User Features
- Create/join groups with shareable codes
- Select member identity from dropdown
- Claim available tasks
- Complete claimed tasks (earns points)
- View leaderboard (ranked by points)
- View activity history

### Admin Features (PIN protected)
- Add/remove members
- Adjust member points manually (with notes)
- Create tasks (one-time or recurring: daily/weekly/biweekly/monthly)
- Edit/delete tasks
- Manage group settings

## Task Flow

1. Admin creates task (status: `available`)
2. Member claims task (status: `claimed`, `claimedBy` set)
3. Member completes task (status: `completed`, points awarded)
4. If recurring: new task auto-created with next due date

## Security Notes

- Firestore rules currently allow all read/write (development mode)
- Admin PIN stored in plaintext
- No user authentication - trust-based system with group PIN
- HTML escaping implemented for XSS prevention

## Deployment

```bash
# Deploy to Firebase
firebase deploy

# Deploy only hosting
firebase deploy --only hosting

# Deploy only Firestore rules
firebase deploy --only firestore:rules
```

## Development

No build step required - vanilla JS runs directly in browser. Just serve the files locally or use Firebase emulators:

```bash
firebase emulators:start
```

## Future Considerations

- Implement proper Firestore security rules
- Add user authentication (Firebase Auth)
- Hash admin PINs
- Add task assignment when no volunteers (per original concept)
- Mobile app version
