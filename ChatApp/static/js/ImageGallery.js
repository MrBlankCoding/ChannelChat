class ImageGallery {
  constructor(options = {}) {
    this.options = {
      animationDuration: 300,
      preloadNext: true,
      closeOnBackdropClick: true,
      showImageCaption: true,
      thumbnailSize: 60, // Size of thumbnails in preview bar
      maxThumbnails: 8, // Maximum thumbnails to show at once
      ...options,
    };

    this.modal = this.createModal();
    this.currentIndex = 0;
    this.images = [];
    this.imageData = [];
    this.isAnimating = false;

    document.body.appendChild(this.modal);
    this.setupKeyboardNavigation();
    this.setupTouchNavigation();
    this.preloadImage = new Image();
  }

  createModal() {
    const modal = document.createElement("div");
    modal.className =
      "fixed inset-0 z-50 hidden bg-black/90 flex items-center justify-center transition-opacity duration-300 opacity-0";
    modal.id = "imageGalleryModal"; // Add an ID to help identify the modal

    modal.innerHTML = `
      <div class="absolute inset-0" id="galleryBackdrop"></div>
      
      <div class="absolute top-4 left-4 flex gap-2 z-50">
        <button class="text-white hover:text-gray-300 transition-colors p-2" id="galleryDownload">
          <i class="fa-solid fa-download"></i>
        </button>
        <button class="text-white hover:text-gray-300 transition-colors p-2" id="galleryZoomIn">
          <i class="fa-solid fa-magnifying-glass-plus"></i>
        </button>
        <button class="text-white hover:text-gray-300 transition-colors p-2" id="galleryZoomOut">
          <i class="fa-solid fa-magnifying-glass-minus"></i>
        </button>
      </div>
      
      <button class="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors p-2 z-50" id="galleryClose">
        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      </button>
      
      <button class="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 transition-transform hover:scale-110 bg-black/50 p-2 rounded-full z-50" id="galleryPrev">
        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
        </svg>
      </button>
      
      <button class="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 transition-transform hover:scale-110 bg-black/50 p-2 rounded-full z-50" id="galleryNext">
        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
        </svg>
      </button>
      
      <div class="w-full h-full flex items-center justify-center">
        <div class="relative" id="galleryImageContainer">
          <img id="galleryImage" class="max-h-[75vh] max-w-[90vw] object-contain transition-transform duration-300" />
          <div class="absolute inset-0 opacity-0 pointer-events-none" id="galleryLoader">
            <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="absolute bottom-20 left-0 right-0 text-center">
        <div class="text-white text-sm px-4 py-2 inline-block rounded bg-black/60" id="galleryCounter"></div>
        <div class="mt-2 text-white max-w-lg mx-auto px-4 text-center" id="galleryCaption"></div>
      </div>
      
      <!-- Preview Bar -->
      <div class="absolute bottom-0 left-0 right-0 h-16 bg-black/80 flex items-center justify-center">
        <div class="flex items-center space-x-1 overflow-x-auto py-2 px-4 max-w-full gallery-thumbnail-container" id="galleryPreviewBar">
          <!-- Thumbnails will be inserted here -->
        </div>
      </div>
    `;

    // Setup event listeners
    modal
      .querySelector("#galleryClose")
      .addEventListener("click", () => this.hide());
    modal
      .querySelector("#galleryPrev")
      .addEventListener("click", () => this.showPrevious());
    modal
      .querySelector("#galleryNext")
      .addEventListener("click", () => this.showNext());
    modal
      .querySelector("#galleryDownload")
      .addEventListener("click", () => this.downloadCurrentImage());
    modal
      .querySelector("#galleryZoomIn")
      .addEventListener("click", () => this.zoomImage(1.2));
    modal
      .querySelector("#galleryZoomOut")
      .addEventListener("click", () => this.zoomImage(0.8));

    if (this.options.closeOnBackdropClick) {
      modal
        .querySelector("#galleryBackdrop")
        .addEventListener("click", () => this.hide());
    }

    return modal;
  }

  setupKeyboardNavigation() {
    document.addEventListener("keydown", (e) => {
      if (!this.modal.classList.contains("hidden")) {
        if (e.key === "Escape") this.hide();
        if (e.key === "ArrowLeft") this.showPrevious();
        if (e.key === "ArrowRight") this.showNext();
        if (e.key === "+" || e.key === "=") this.zoomImage(1.2);
        if (e.key === "-") this.zoomImage(0.8);
      }
    });
  }

  setupTouchNavigation() {
    let touchStartX = 0;
    let touchEndX = 0;

    const imageContainer = this.modal.querySelector("#galleryImageContainer");

    imageContainer.addEventListener(
      "touchstart",
      (e) => {
        touchStartX = e.changedTouches[0].screenX;
      },
      false
    );

    imageContainer.addEventListener(
      "touchend",
      (e) => {
        touchEndX = e.changedTouches[0].screenX;
        this.handleSwipe();
      },
      false
    );

    this.handleSwipe = () => {
      const threshold = 50; // Minimum swipe distance
      if (touchEndX < touchStartX - threshold) {
        this.showNext(); // Swipe left = next
      } else if (touchEndX > touchStartX + threshold) {
        this.showPrevious(); // Swipe right = previous
      }
    };
  }

  show(clickedImageSrc) {
    // Find only sent images, avoiding profile images and gallery thumbnails
    const imgElements = Array.from(document.querySelectorAll("img")).filter(
      (img) => {
        // Check if it's NOT a profile image (filtering by class and size)
        const isProfileImage =
          img.classList.contains("rounded-full") ||
          img.classList.contains("w-6") ||
          img.classList.contains("h-6") ||
          (img.parentElement && img.parentElement.classList.contains("avatar"));

        // Check if it's NOT a gallery thumbnail
        const isGalleryThumbnail =
          img.closest(".gallery-thumbnail-container") !== null ||
          img.closest("#imageGalleryModal") !== null;

        // Check if it appears to be a sent image
        const isSentImage =
          img.classList.contains("rounded-lg") ||
          img.src.includes("chat-images") ||
          img.src.includes("firebasestorage");

        return isSentImage && !isProfileImage && !isGalleryThumbnail;
      }
    );

    // Create array of image data with captions
    this.images = imgElements.map((img) => img.src);
    this.imageData = imgElements.map((img) => ({
      src: img.src,
      alt: img.alt || "",
      caption: img.getAttribute("data-caption") || img.alt || "",
    }));

    // Find the clicked image index
    this.currentIndex = this.images.findIndex((src) => src === clickedImageSrc);

    // Set initial zoom level
    this.currentZoom = 1;

    // Show the modal
    this.modal.classList.remove("hidden");

    // Force layout recalculation then fade in
    setTimeout(() => {
      this.modal.classList.add("opacity-100");
    }, 10);

    // Update display
    this.updateDisplay();

    // Create thumbnails preview
    this.createThumbnailsPreview();

    // Lock scrolling
    document.body.style.overflow = "hidden";

    // Preload adjacent images
    if (this.options.preloadNext) {
      this.preloadAdjacentImages();
    }
  }

  createThumbnailsPreview() {
    const previewBar = this.modal.querySelector("#galleryPreviewBar");
    previewBar.innerHTML = ""; // Clear existing thumbnails

    // Determine how many thumbnails to show
    const numImagesToShow = Math.min(
      this.images.length,
      this.options.maxThumbnails
    );

    // Calculate start and end indices to center around current image
    let startIdx = Math.max(
      0,
      this.currentIndex - Math.floor(numImagesToShow / 2)
    );
    if (startIdx + numImagesToShow > this.images.length) {
      startIdx = Math.max(0, this.images.length - numImagesToShow);
    }

    // Create thumbnail elements
    for (let i = 0; i < numImagesToShow; i++) {
      const idx = (startIdx + i) % this.images.length;
      const thumbnail = document.createElement("div");

      // Set thumbnail styles and classes
      thumbnail.className = `thumbnail-container flex-shrink-0 cursor-pointer transition-all duration-200 ${
        idx === this.currentIndex
          ? "border-2 border-white scale-110 z-10"
          : "opacity-70 scale-100"
      }`;
      thumbnail.style.width = `${this.options.thumbnailSize}px`;
      thumbnail.style.height = `${this.options.thumbnailSize}px`;

      thumbnail.innerHTML = `
        <img src="${this.imageData[idx].src}" 
             alt="Thumbnail" 
             class="w-full h-full object-cover rounded gallery-thumbnail" />
      `;

      // Add click event to jump to this image
      thumbnail.addEventListener("click", () => {
        if (idx !== this.currentIndex) {
          this.isAnimating = true;
          this.fadeOutImage(() => {
            this.currentIndex = idx;
            this.updateDisplay(true);
            this.updateThumbnailSelection();
            this.preloadAdjacentImages();
          });
        }
      });

      previewBar.appendChild(thumbnail);
    }
  }

  updateThumbnailSelection() {
    // Update which thumbnail is highlighted
    const thumbnails = this.modal.querySelectorAll(".thumbnail-container");
    thumbnails.forEach((thumb, i) => {
      // Get index from the DOM order, not necessarily the image array order
      const thumbnailImg = thumb.querySelector("img");
      const imgSrc = thumbnailImg.src;
      const imgIndex = this.images.indexOf(imgSrc);

      if (imgIndex === this.currentIndex) {
        thumb.classList.add("border-2", "border-white", "scale-110", "z-10");
        thumb.classList.remove("opacity-70", "scale-100");
      } else {
        thumb.classList.remove("border-2", "border-white", "scale-110", "z-10");
        thumb.classList.add("opacity-70", "scale-100");
      }
    });
  }

  hide() {
    // Fade out animation
    this.modal.classList.remove("opacity-100");

    // Wait for animation to complete then hide
    setTimeout(() => {
      this.modal.classList.add("hidden");
      document.body.style.overflow = "";
    }, this.options.animationDuration);
  }

  showPrevious() {
    if (this.images.length <= 1 || this.isAnimating) return;

    this.isAnimating = true;
    this.fadeOutImage(() => {
      this.currentIndex =
        (this.currentIndex - 1 + this.images.length) % this.images.length;
      this.updateDisplay(true);
      this.updateThumbnailSelection();
      this.preloadAdjacentImages();
    });
  }

  showNext() {
    if (this.images.length <= 1 || this.isAnimating) return;

    this.isAnimating = true;
    this.fadeOutImage(() => {
      this.currentIndex = (this.currentIndex + 1) % this.images.length;
      this.updateDisplay(true);
      this.updateThumbnailSelection();
      this.preloadAdjacentImages();
    });
  }

  fadeOutImage(callback) {
    const img = this.modal.querySelector("#galleryImage");
    img.style.opacity = 0;

    setTimeout(() => {
      callback();
    }, 150); // Half the animation duration
  }

  updateDisplay(animate = false) {
    const img = this.modal.querySelector("#galleryImage");
    const loader = this.modal.querySelector("#galleryLoader");
    const caption = this.modal.querySelector("#galleryCaption");

    // Reset zoom
    this.currentZoom = 1;
    img.style.transform = `scale(1)`;

    // Show loader
    loader.classList.remove("opacity-0");
    loader.classList.add("opacity-100");

    // Set the image source
    const currentImage = this.imageData[this.currentIndex];
    img.src = currentImage.src;
    img.alt = currentImage.alt;

    // Handle image load
    img.onload = () => {
      // Hide loader
      loader.classList.remove("opacity-100");
      loader.classList.add("opacity-0");

      // Show image with animation if needed
      if (animate) {
        img.style.opacity = 0;
        setTimeout(() => {
          img.style.opacity = 1;
          this.isAnimating = false;
        }, 50);
      } else {
        img.style.opacity = 1;
      }
    };

    // Update counter
    const counter = this.modal.querySelector("#galleryCounter");
    counter.textContent = `${this.currentIndex + 1} / ${this.images.length}`;

    // Update caption if enabled
    if (this.options.showImageCaption) {
      caption.textContent = currentImage.caption;
      caption.style.display = currentImage.caption ? "block" : "none";
    } else {
      caption.style.display = "none";
    }

    // Show/hide navigation buttons based on number of images
    const prevBtn = this.modal.querySelector("#galleryPrev");
    const nextBtn = this.modal.querySelector("#galleryNext");
    prevBtn.style.display = this.images.length > 1 ? "block" : "none";
    nextBtn.style.display = this.images.length > 1 ? "block" : "none";
  }

  zoomImage(factor) {
    const img = this.modal.querySelector("#galleryImage");
    this.currentZoom *= factor;

    // Limit zoom range
    this.currentZoom = Math.max(0.5, Math.min(3, this.currentZoom));

    img.style.transform = `scale(${this.currentZoom})`;
  }

  preloadAdjacentImages() {
    if (this.images.length <= 1) return;

    // Preload next image
    const nextIndex = (this.currentIndex + 1) % this.images.length;
    this.preloadImage.src = this.images[nextIndex];

    // Preload previous image
    const prevIndex =
      (this.currentIndex - 1 + this.images.length) % this.images.length;
    setTimeout(() => {
      this.preloadImage.src = this.images[prevIndex];
    }, 100);
  }

  downloadCurrentImage() {
    if (this.images.length === 0 || this.currentIndex < 0) return;

    const currentImageUrl = this.images[this.currentIndex];

    // For Firebase Storage or other URLs that might have CORS restrictions
    fetch(currentImageUrl)
      .then((response) => response.blob())
      .then((blob) => {
        // Create a blob URL for the image
        const blobUrl = URL.createObjectURL(blob);

        // Create a temporary link element
        const link = document.createElement("a");
        link.href = blobUrl;

        // Extract filename from URL or use a default name
        let filename = "image.jpg";
        try {
          // Try to get the filename from the URL path
          const urlPath = new URL(currentImageUrl).pathname;
          const pathSegments = urlPath.split("/");
          const lastSegment = pathSegments[pathSegments.length - 1];

          // If there's a query string, remove it
          filename = lastSegment.split("?")[0];

          // If no extension, add .jpg
          if (!filename.includes(".")) {
            filename += ".jpg";
          }
        } catch (e) {
          console.error("Error extracting filename:", e);
          // Use default filename
        }

        link.download = filename;

        // Append to body, click, and remove
        document.body.appendChild(link);
        link.click();

        // Clean up
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
      })
  }
}

export default ImageGallery;
