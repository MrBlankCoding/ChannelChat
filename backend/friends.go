package main

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	firebaseAuth "firebase.google.com/go/v4/auth"
	"github.com/lithammer/fuzzysearch/fuzzy"
	appAuth "github.com/mrblankcoding/channelchat/auth"
	"google.golang.org/api/iterator"
)

type UserProfile struct {
	UID      string `json:"uid" firestore:"uid"`
	Email    string `json:"email" firestore:"email"`
	Username string `json:"username" firestore:"username"`
	PhotoURL string `json:"photoUrl" firestore:"photoUrl"`
}

type FriendRequest struct {
	FromUID      string      `json:"fromUid" firestore:"fromUid"`
	FromUsername string      `json:"fromUsername" firestore:"fromUsername"`
	FromEmail    string      `json:"fromEmail" firestore:"fromEmail"`
	FromPhotoURL string      `json:"fromPhotoUrl" firestore:"fromPhotoUrl"`
	Status       string      `json:"status" firestore:"status"`
	Timestamp    interface{} `json:"timestamp" firestore:"timestamp"`
}

func EnsureUserExists(ctx context.Context, token *firebaseAuth.Token) error {
	// Create a background context with timeout so DB ops don't die if the request is canceled
	dbCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	docRef := appAuth.FirestoreClient.Collection("users").Doc(token.UID)
	doc, err := docRef.Get(dbCtx)
	
	photoURL, _ := token.Claims["picture"].(string)

	if err != nil && strings.Contains(err.Error(), "code = NotFound") {
		_, err = docRef.Set(dbCtx, map[string]interface{}{
			"uid":      token.UID,
			"email":    token.Claims["email"],
			"username": strings.Split(token.Claims["email"].(string), "@")[0],
			"photoUrl": photoURL,
		})
		return err
	}
	
	// Optional: Update photo if it changed
	if err == nil {
		var existing UserProfile
		doc.DataTo(&existing)
		if existing.PhotoURL != photoURL && photoURL != "" {
			docRef.Update(dbCtx, []firestore.Update{{Path: "photoUrl", Value: photoURL}})
		}
	}

	_ = doc
	return err
}

func SearchUsersHandler(w http.ResponseWriter, r *http.Request) {
	query := strings.ToLower(r.URL.Query().Get("q"))
	if query == "" {
		http.Error(w, "Query parameter 'q' is required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	var allUsers []UserProfile

	iter := appAuth.FirestoreClient.Collection("users").Limit(500).Documents(ctx)
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		var p UserProfile
		doc.DataTo(&p)
		allUsers = append(allUsers, p)
	}

	type scoredUser struct {
		user  UserProfile
		score int
	}
	var scoredResults []scoredUser

	for _, user := range allUsers {
		username := strings.ToLower(user.Username)
		if fuzzy.Match(query, username) {
			score := fuzzy.LevenshteinDistance(query, username)
			scoredResults = append(scoredResults, scoredUser{user, score})
		}
	}

	sort.Slice(scoredResults, func(i, j int) bool {
		return scoredResults[i].score < scoredResults[j].score
	})

	var finalUsers []UserProfile
	for i, sr := range scoredResults {
		if i >= 10 {
			break
		}
		finalUsers = append(finalUsers, sr.user)
	}

	if finalUsers == nil {
		finalUsers = []UserProfile{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(finalUsers)
}

func SendFriendRequestHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	currentUserToken := r.Context().Value("user").(*firebaseAuth.Token)
	var body struct {
		ToUID string `json:"toUid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid body", http.StatusBadRequest)
		return
	}

	if currentUserToken.UID == body.ToUID {
		http.Error(w, "Cannot add yourself", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	
	userDoc, _ := appAuth.FirestoreClient.Collection("users").Doc(currentUserToken.UID).Get(ctx)
	var currentUser UserProfile
	userDoc.DataTo(&currentUser)

	_, err := appAuth.FirestoreClient.Collection("users").Doc(body.ToUID).
		Collection("incoming_requests").Doc(currentUserToken.UID).Set(ctx, map[string]interface{}{
		"fromUid":      currentUserToken.UID,
		"fromUsername": currentUser.Username,
		"fromEmail":    currentUser.Email,
		"fromPhotoUrl": currentUser.PhotoURL,
		"status":       "pending",
		"timestamp":    firestore.ServerTimestamp,
	})

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "request_sent"})
}

func AcceptFriendRequestHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	currentUserToken := r.Context().Value("user").(*firebaseAuth.Token)
	var body struct {
		FromUID string `json:"fromUid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid body", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	
	_, err := appAuth.FirestoreClient.Collection("users").Doc(currentUserToken.UID).
		Collection("incoming_requests").Doc(body.FromUID).Delete(ctx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	batch := appAuth.FirestoreClient.Batch()
	
	ref1 := appAuth.FirestoreClient.Collection("users").Doc(currentUserToken.UID).Collection("friends").Doc(body.FromUID)
	batch.Set(ref1, map[string]interface{}{"addedAt": firestore.ServerTimestamp})
	
	ref2 := appAuth.FirestoreClient.Collection("users").Doc(body.FromUID).Collection("friends").Doc(currentUserToken.UID)
	batch.Set(ref2, map[string]interface{}{"addedAt": firestore.ServerTimestamp})

	_, err = batch.Commit(ctx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "accepted"})
}

func ListIncomingRequestsHandler(w http.ResponseWriter, r *http.Request) {
	currentUserToken := r.Context().Value("user").(*firebaseAuth.Token)
	ctx := r.Context()

	iter := appAuth.FirestoreClient.Collection("users").Doc(currentUserToken.UID).
		Collection("incoming_requests").Documents(ctx)

	requests := []FriendRequest{}
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		var req FriendRequest
		doc.DataTo(&req)
		requests = append(requests, req)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(requests)
}

func ListFriendsHandler(w http.ResponseWriter, r *http.Request) {
	currentUserToken := r.Context().Value("user").(*firebaseAuth.Token)
	ctx := r.Context()

	iter := appAuth.FirestoreClient.Collection("users").Doc(currentUserToken.UID).
		Collection("friends").Documents(ctx)

	friends := []UserProfile{}
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		friendProfileDoc, err := appAuth.FirestoreClient.Collection("users").Doc(doc.Ref.ID).Get(ctx)
		if err == nil {
			var p UserProfile
			friendProfileDoc.DataTo(&p)
			friends = append(friends, p)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(friends)
}
