module.exports = {
  darkMode: "class", // Enable class-based dark mode
  content: [
    "./templates/**/*.{html,js}", // Include HTML templates
    "./static/js/**/*.{js,ts}", // Include JavaScript files
    "./static/css/**/*.{css}", // Include CSS files
  ],
  theme: {
    extend: {
      colors: {
        "deep-navy": "#0A1E3C",
        "electric-blue": "#1E90FF",
        "soft-blue": "#4D7CFE",
        "dark-slate": "#1F2937",
        "accent-cyan": "#00FFD4",
        "message-blue": "#2C5282",
        "message-gray": "#4A5568",
        "light-background": "#F3F4F6",
        "light-text": "#1F2937",
      },
      backgroundImage: {
        "gradient-primary": "linear-gradient(135deg, #1E90FF 0%, #4D7CFE 100%)",
        "gradient-secondary":
          "linear-gradient(135deg, #00FFD4 0%, #4D7CFE 100%)",
        "chat-pattern":
          "linear-gradient(to bottom right, rgba(75, 124, 254, 0.1) 0%, rgba(0, 255, 212, 0.1) 100%)",
        "glass-gradient":
          "linear-gradient(to right bottom, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.05))",
      },
      boxShadow: {
        "message-shadow":
          "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
        "card-hover":
          "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
        glass: "0 8px 32px 0 rgba(31, 38, 135, 0.37)",
      },
    },
  },
  plugins: [],
};
