package auth

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"cloud.google.com/go/firestore"
	"github.com/joho/godotenv"
	"google.golang.org/api/option"
)

var AuthClient *auth.Client
var FirestoreClient *firestore.Client

func InitFirebase() {
	ctx := context.Background()
	if err := godotenv.Load(); err != nil {
		godotenv.Load("../.env")
	}

	credsFile := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
	projectID := os.Getenv("FIREBASE_PROJECT_ID")
	
	if projectID == "" {
		log.Println("WARNING: FIREBASE_PROJECT_ID is empty in environment")
	} else {
		fmt.Printf("Firebase Project ID: %s\n", projectID)
	}

	var app *firebase.App
	var err error

	config := &firebase.Config{
		ProjectID: projectID,
	}

	if credsFile != "" {
		fmt.Printf("Initializing Firebase with credentials from: %s\n", credsFile)
		opt := option.WithServiceAccountFile(credsFile)
		app, err = firebase.NewApp(ctx, config, opt)
	} else {
		fmt.Println("Initializing Firebase with default credentials")
		app, err = firebase.NewApp(ctx, config)
	}

	if err != nil {
		log.Fatalf("error initializing app: %v\n", err)
	}

	AuthClient, err = app.Auth(ctx)
	if err != nil {
		log.Fatalf("error getting Auth client: %v\n", err)
	}

	FirestoreClient, err = app.Firestore(ctx)
	if err != nil {
		log.Fatalf("error getting Firestore client: %v\n", err)
	}

	fmt.Println("Firebase Auth and Firestore initialized successfully")
}

func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		var idToken string

		if authHeader != "" {
			idToken = strings.TrimPrefix(authHeader, "Bearer ")
			if idToken == authHeader {
				log.Println("Missing Bearer prefix in Authorization header")
				http.Error(w, "Authorization header must be Bearer token", http.StatusUnauthorized)
				return
			}
		} else {
			idToken = r.URL.Query().Get("token")
		}

		if idToken == "" {
			http.Error(w, "Authorization required", http.StatusUnauthorized)
			return
		}

		if AuthClient == nil {
			log.Println("AuthClient is not initialized")
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}

		token, err := AuthClient.VerifyIDToken(r.Context(), idToken)
		if err != nil {
			log.Printf("error verifying ID token: %v. Token: %s...\n", err, idToken[:10])
			http.Error(w, "Invalid token", http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), "user", token)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
