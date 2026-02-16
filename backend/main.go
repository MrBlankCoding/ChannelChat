package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	firebaseAuth "firebase.google.com/go/v4/auth"
	"github.com/mrblankcoding/channelchat/auth"
	"github.com/mrblankcoding/channelchat/ws"
)

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "http://localhost:5173")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func main() {
	auth.InitFirebase()
	hub := ws.NewHub()
	go hub.Run()

	finalMux := http.NewServeMux()
	
	finalMux.HandleFunc("/public", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "This is a public endpoint")
	})
	
	protectedMux := http.NewServeMux()
	
	protectedMux.HandleFunc("/protected", func(w http.ResponseWriter, r *http.Request) {
		token := r.Context().Value("user").(*firebaseAuth.Token)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"message": fmt.Sprintf("Hello, %s!", token.Claims["email"]),
			"uid":     token.UID,
		})
	})

	// WebSocket endpoint
	protectedMux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		token := r.Context().Value("user").(*firebaseAuth.Token)
		ws.ServeWs(hub, w, r, token.UID)
	})

	protectedMux.HandleFunc("/users/search", SearchUsersHandler)
	protectedMux.HandleFunc("/friends/request", SendFriendRequestHandler)
	protectedMux.HandleFunc("/friends/requests", ListIncomingRequestsHandler)
	protectedMux.HandleFunc("/friends/accept", AcceptFriendRequestHandler)
	protectedMux.HandleFunc("/friends", ListFriendsHandler)

	authHandler := auth.AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Context().Value("user").(*firebaseAuth.Token)
		if err := EnsureUserExists(r.Context(), token); err != nil {
			log.Printf("Error ensuring user exists: %v\n", err)
		}
		protectedMux.ServeHTTP(w, r)
	}))

	finalMux.Handle("/", authHandler)

	fmt.Println("Server starting on :8080...")
	if err := http.ListenAndServe(":8080", corsMiddleware(finalMux)); err != nil {
		log.Fatal(err)
	}
}
