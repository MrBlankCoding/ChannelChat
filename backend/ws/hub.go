package ws

import (
	"sync"
)

// keeps track of active clients and broadcasts
type Hub struct {
	// REGISTERED clients by UUID
	clients map[string]*Client
	// inboud messages
	broadcast chan *Message
	// these kinda explain theirselves
	register chan *Client
	unregister chan *Client
	
	mu sync.RWMutex
}

type Message struct {
	ID          string `json:"id"`
	Type        string `json:"type"` // "text", "read_receipt", "reaction", "edit", "delete"
	SenderUID   string `json:"senderUid"`
	ReceiverUID string `json:"receiverUid"`
	Content     string `json:"content"`
	Timestamp   int64  `json:"timestamp"`
	Read        bool   `json:"read"`
	ReplyTo     string `json:"replyTo,omitempty"`
	ReplyContent string `json:"replyContent,omitempty"`
}

func NewHub() *Hub {
	return &Hub{
		broadcast:  make(chan *Message),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		clients:    make(map[string]*Client),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.UID] = client
			h.mu.Unlock()
		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.UID]; ok {
				delete(h.clients, client.UID)
				close(client.Send)
			}
			h.mu.Unlock()
		case message := <-h.broadcast:
			h.mu.RLock()
			
			// 1. Send to Recipient
			if recipient, ok := h.clients[message.ReceiverUID]; ok {
				select {
				case recipient.Send <- message:
				default:
					close(recipient.Send)
					delete(h.clients, message.ReceiverUID)
				}
			}
			
			// 2. Send back to Sender (for confirmation and multi-device sync)
			// We do this for ALL types except read_receipt (which is handled locally)
			if message.Type != "read_receipt" {
				if sender, ok := h.clients[message.SenderUID]; ok {
					select {
					case sender.Send <- message:
					default:
					}
				}
			}

			h.mu.RUnlock()
		}
	}
}
