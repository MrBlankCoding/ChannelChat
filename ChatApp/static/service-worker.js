
    // Based off of https://github.com/pwa-builder/PWABuilder/blob/main/docs/sw.js

    /*
      Welcome to our basic Service Worker! This Service Worker offers a basic offline experience
      while also being easily customizeable. You can add in your own code to implement the capabilities
      listed below, or change anything else you would like.


      Need an introduction to Service Workers? Check our docs here: https://docs.pwabuilder.com/#/home/sw-intro
      Want to learn more about how our Service Worker generation works? Check our docs here: https://docs.pwabuilder.com/#/studio/existing-app?id=add-a-service-worker

      Did you know that Service Workers offer many more capabilities than just offline? 
        - Background Sync: https://microsoft.github.io/win-student-devs/#/30DaysOfPWA/advanced-capabilities/06
        - Periodic Background Sync: https://web.dev/periodic-background-sync/
        - Push Notifications: https://microsoft.github.io/win-student-devs/#/30DaysOfPWA/advanced-capabilities/07?id=push-notifications-on-the-web
        - Badges: https://microsoft.github.io/win-student-devs/#/30DaysOfPWA/advanced-capabilities/07?id=application-badges
    */

import { precacheAndRoute } from "workbox-precaching/precacheAndRoute";
precacheAndRoute([
  {
    revision: "8838ac251462a5da2cd1dc0a136ee953",
    url: "css/input.css",
  },
  {
    revision: "2f102c61365edee5dc0a4478af9a63a1",
    url: "css/output.css",
  },
  {
    revision: "c10d9fdb3a38d644931cb72d1b409646",
    url: "firebase-messaging-sw.js",
  },
  {
    revision: "6d2fb01e78764429d1a0709f2cfb8bdf",
    url: "js/app.js",
  },
  {
    revision: "3687c6b99a7525dddbaac264cca141cc",
    url: "js/auth.js",
  },
  {
    revision: "5874c8325bf2b7e3a1c1fea2f98f7504",
    url: "js/authAxios.js",
  },
  {
    revision: "3756e743b9839c877fd8756b5f4af497",
    url: "js/ChatManager.js",
  },
  {
    revision: "d7a98605bd12a6599cfe620d1313d44f",
    url: "js/ChatUI.js",
  },
  {
    revision: "c058fe3ad21ce39314c45233d4f9e2d0",
    url: "js/firebase-messaging-sw.js",
  },
  {
    revision: "344421946926b46307faca78fcc82bea",
    url: "js/firebaseConfig.js",
  },
  {
    revision: "9b86498703051c128fc278c91058a75a",
    url: "js/forgot-password.js",
  },
  {
    revision: "b7d0bee57520ce77e78cb7a3de118dbe",
    url: "js/ImageGallery.js",
  },
  {
    revision: "60052eaa1ab0dc04d4b9f67e22a61f0c",
    url: "js/login.js",
  },
  {
    revision: "532b79788b3322084f42c77117679eed",
    url: "js/MessageRenderer.js",
  },
  {
    revision: "570633c0afc9fe4bb88f9a4bb3ea2a14",
    url: "js/NotificationManager.js",
  },
  {
    revision: "74b786bd096dcef7435d0ff1e4fd0eb8",
    url: "js/PresenceManager.js",
  },
  {
    revision: "110d5a1350f731d80417483144bcb12f",
    url: "js/register.js",
  },
  {
    revision: "733bb88f5f335bb388ddd965d0849399",
    url: "js/settings.js",
  },
  {
    revision: "1eb5cfd5db200b145e3449d266fcc269",
    url: "js/Sidebar.js",
  },
  {
    revision: "6f081820979adf411c18182d0dd315d2",
    url: "js/UserInviteManager.js",
  },
  {
    revision: "f78a23224bfe57ff407d114f0f3f8409",
    url: "js/WebSocketManager.js",
  },
  {
    revision: "e6326418dd72f2a2994f248bc0624a0b",
    url: "service-worker.js",
  },
]);
