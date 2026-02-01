// Firebase configuration
// Replace these values with your Firebase project config
// Get this from: Firebase Console > Project Settings > Your apps > Config

const firebaseConfig = {
    apiKey: "AIzaSyCQmG16vrMB0sQ2D9R8RQGZDN5x-Rxpiao",
    authDomain: "bummer-currency.firebaseapp.com",
    projectId: "bummer-currency",
    storageBucket: "bummer-currency.firebasestorage.app",
    messagingSenderId: "909820440566",
    appId: "1:909820440566:web:793d4692d5a989dafbe1d7"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Firestore
const db = firebase.firestore();

// Helper to generate group codes like "HOUSE-7K3M"
function generateGroupCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing chars like 0/O, 1/I
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code += '-';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Toast notification helper
function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}
