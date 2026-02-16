import { writable } from 'svelte/store';
import { auth } from './firebase';

export interface Message {
    id: string;
    type: 'text' | 'read_receipt' | 'reaction' | 'edit' | 'delete';
    senderUid: string;
    receiverUid: string;
    content: string;
    timestamp: number;
    read: boolean;
    replyTo?: string;
    replyContent?: string;
    reactions?: Record<string, string[]>;
    isEdited?: boolean;
    isDeleted?: boolean;
}

export const messages = writable<Message[]>([]);
let socket: WebSocket | null = null;

export async function connectToChat() {
    if (socket && socket.readyState === WebSocket.OPEN) return;

    const user = auth.currentUser;
    if (!user) return;

    const token = await user.getIdToken();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//localhost:8080/ws?token=${token}`);

    socket.onmessage = (event) => {
        const msg: Message = JSON.parse(event.data);
        
        if (msg.type === 'read_receipt') {
            messages.update(prev => prev.map(m => 
                (m.senderUid === msg.receiverUid && m.receiverUid === msg.senderUid) ? { ...m, read: true } : m
            ));
            return;
        }

        if (msg.type === 'reaction' || msg.type === 'edit' || msg.type === 'delete') {
            messages.update(prev => prev.map(m => {
                if (m.id === msg.id) {
                    if (msg.type === 'edit') return { ...m, content: msg.content, isEdited: true };
                    if (msg.type === 'delete') return { ...m, content: 'This message was deleted', isDeleted: true, reactions: {} };
                    if (msg.type === 'reaction') {
                        const reactions = { ...(m.reactions || {}) };
                        const uids = [...(reactions[msg.content] || [])];
                        if (uids.includes(msg.senderUid)) {
                            reactions[msg.content] = uids.filter(id => id !== msg.senderUid);
                        } else {
                            reactions[msg.content] = [...uids, msg.senderUid];
                        }
                        return { ...m, reactions };
                    }
                }
                return m;
            }));
            return;
        }

        messages.update(prev => {
            if (prev.some(p => p.id === msg.id)) return prev;
            return [...prev, msg];
        });
    };

    socket.onclose = () => {
        socket = null;
        setTimeout(connectToChat, 3000);
    }
}

export function sendMessage(receiverUid: string, content: string, replyTo?: Message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const msg = {
        id: Date.now().toString() + '_' + auth.currentUser?.uid,
        type: 'text',
        receiverUid,
        content,
        replyTo: replyTo?.id,
        replyContent: replyTo?.content,
        senderUid: auth.currentUser?.uid,
        timestamp: Math.floor(Date.now() / 1000),
        read: false
    };
    
    messages.update(prev => [...prev, msg as Message]);
    
    socket.send(JSON.stringify(msg));
}

export function sendReaction(receiverUid: string, messageId: string, emoji: string) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    
    socket.send(JSON.stringify({ 
        id: messageId, 
        type: 'reaction', 
        receiverUid, 
        content: emoji,
        senderUid: auth.currentUser?.uid
    }));
}

export function sendEdit(receiverUid: string, messageId: string, newContent: string) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ id: messageId, type: 'edit', receiverUid, content: newContent }));
}

export function sendDelete(receiverUid: string, messageId: string) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ id: messageId, type: 'delete', receiverUid }));
}

export function sendReadReceipt(friendUid: string) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'read_receipt', receiverUid: friendUid }));
    messages.update(prev => prev.map(m => m.senderUid === friendUid ? { ...m, read: true } : m));
}
