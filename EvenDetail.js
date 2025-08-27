import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import RoleList from '../components/RoleList';

const EventDetail = () => {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const { id } = useParams();
  const { currentUser } = useAuth();

  useEffect(() => {
    const fetchEvent = async () => {
      try {
        const response = await api.get(`/events/${id}`);
        setEvent(response.data);
      } catch (error) {
        console.error('Error fetching event:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchEvent();
  }, [id]);

  const handleRoleSignup = async (roleId) => {
    if (!currentUser || currentUser.type !== 'volunteer') {
      alert('Please login as a volunteer to sign up for roles');
      return;
    }

    try {
      await api.post(`/roles/${roleId}/signup`);
      alert('Successfully signed up for this role!');
      // Refresh event data to update volunteer counts
      const response = await api.get(`/events/${id}`);
      setEvent(response.data);
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to sign up for role');
    }
  };

  if (loading) return <div>Loading...</div>;
  if (!event) return <div>Event not found</div>;

  return (
    <div className="event-detail">
      <h1>{event.title}</h1>
      <p>Organized by: {event.organizer_name}</p>
      <p>Date: {new Date(event.date).toLocaleString()}</p>
      <p>Location: {event.location}</p>
      <p>{event.description}</p>
      
      <h2>Available Roles</h2>
      <RoleList 
        roles={event.roles} 
        onSignup={handleRoleSignup}
        showSignup={currentUser?.type === 'volunteer'}
      />
      
      {currentUser?.type === 'org' && currentUser.id === event.organizer_id && (
        <a href={`/coordinator/${event.id}`} className="coordinator-link">
          Manage Event Volunteers
        </a>
      )}
    </div>
  );
};

export default EventDetail;
