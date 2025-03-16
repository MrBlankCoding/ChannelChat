const styles = `
.message-actions {
    visibility: hidden;
    opacity: 0;
    transition: opacity 0.2s ease-in-out, visibility 0.2s ease-in-out;
    z-index: 10;
}

.message:hover .message-actions {
    visibility: visible;
    opacity: 1;
}

.action-button {
    padding: 4px;
    border-radius: 4px;
    transition: background-color 0.2s ease-in-out;
}

.action-button:hover {
    background-color: #f3f4f6;
}
    @keyframes slideDown {
    from {
        opacity: 0;
        transform: translateY(-10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}
    .loading-more-indicator {
    position: sticky;
    top: 0;
    z-index: 10;
    background: rgba(255, 255, 255, 0.9);
}

.hidden {
    display: none;
}

@keyframes slideUp {
    from {
        opacity: 1;
        transform: translateY(0);
    }
    to {
        opacity: 0;
        transform: translateY(-10px);
    }
}
`;

const styleSheet = document.createElement("style");
styleSheet.type = "text/css";
styleSheet.textContent = styles;

// Append 
document.head.appendChild(styleSheet);
