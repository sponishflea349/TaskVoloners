import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Navigation from './components/Navigation';
import Home from './pages/Home';
import EventDetail from './pages/EventDetail';
import Dashboard from './pages/Dashboard';
import Coordinator from './pages/Coordinator';
import Profile from './pages/Profile';
import LoginForm from './components/LoginForm';
import RegisterForm from './components/RegisterForm';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="App">
          <Navigation />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<LoginForm />} />
            <Route path="/register" element={<RegisterForm />} />
            <Route path="/event/:id" element={<EventDetail />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/coordinator/:eventId" element={<Coordinator />} />
            <Route path="/profile" element={<Profile />} />
          </Routes>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
