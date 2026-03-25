import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB86JgD1A7kDyWMkzBEv2pe3kp8vSO3NOI",
  authDomain: "la-barra-data.firebaseapp.com",
  projectId: "la-barra-data",
  storageBucket: "la-barra-data.firebasestorage.app",
  messagingSenderId: "569077611362",
  appId: "1:569077611362:web:6385174d945499a8278a3b",
  measurementId: "G-NEK5169RD2"
};

// Initialize Firebase
let app, db;
try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    console.log("🔥 Firebase y Base de Datos Inicializados Correctamente");
} catch (e) {
    console.error("Error al inicializar Firebase:", e);
}

export { db };
