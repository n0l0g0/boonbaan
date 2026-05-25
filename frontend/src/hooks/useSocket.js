import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../services/api';

export function useSocket(event, handler) {
  const socketRef = useRef(null);

  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io(SOCKET_URL);
    }
    const socket = socketRef.current;
    socket.on(event, handler);
    return () => socket.off(event, handler);
  }, [event, handler]);
}
