class ImageGallery {
  constructor() {
    this.modal = this.createModal();
    this.currentIndex = 0;
    this.images = [];
    document.body.appendChild(this.modal);
    this.setupKeyboardNavigation();
  }

  createModal() {
    const modal = document.createElement("div");
    modal.className =
      "fixed inset-0 z-50 hidden bg-black/90 flex items-center justify-center";

    modal.innerHTML = `
      <button class="absolute top-4 right-4 text-white hover:text-gray-300 z-50" id="galleryClose">
        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      </button>
      
      <button class="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 z-50" id="galleryPrev">
        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
        </svg>
      </button>
      
      <button class="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 z-50" id="galleryNext">
        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
        </svg>
      </button>
      
      <div class="w-full h-full flex items-center justify-center">
        <img id="galleryImage" class="max-h-[90vh] max-w-[90vw] object-contain" />
      </div>
      
      <div class="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm" id="galleryCounter"></div>
    `;

    modal
      .querySelector("#galleryClose")
      .addEventListener("click", () => this.hide());
    modal
      .querySelector("#galleryPrev")
      .addEventListener("click", () => this.showPrevious());
    modal
      .querySelector("#galleryNext")
      .addEventListener("click", () => this.showNext());

    return modal;
  }

  setupKeyboardNavigation() {
    document.addEventListener("keydown", (e) => {
      if (!this.modal.classList.contains("hidden")) {
        if (e.key === "Escape") this.hide();
        if (e.key === "ArrowLeft") this.showPrevious();
        if (e.key === "ArrowRight") this.showNext();
      }
    });
  }

  show(clickedImageSrc) {
    // Get all images
    this.images = Array.from(
      document.querySelectorAll('.message[data-type="image"] img')
    ).map((img) => img.src);

    this.currentIndex = this.images.findIndex((src) => src === clickedImageSrc);
    this.updateDisplay();
    this.modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  hide() {
    this.modal.classList.add("hidden");
    document.body.style.overflow = "";
  }

  showPrevious() {
    if (this.images.length <= 1) return;
    this.currentIndex =
      (this.currentIndex - 1 + this.images.length) % this.images.length;
    this.updateDisplay();
  }

  showNext() {
    if (this.images.length <= 1) return;
    this.currentIndex = (this.currentIndex + 1) % this.images.length;
    this.updateDisplay();
  }

  updateDisplay() {
    const img = this.modal.querySelector("#galleryImage");
    img.src = this.images[this.currentIndex];

    const counter = this.modal.querySelector("#galleryCounter");
    counter.textContent = `${this.currentIndex + 1} / ${this.images.length}`;

    const prevBtn = this.modal.querySelector("#galleryPrev");
    const nextBtn = this.modal.querySelector("#galleryNext");
    prevBtn.style.display = this.images.length > 1 ? "block" : "none";
    nextBtn.style.display = this.images.length > 1 ? "block" : "none";
  }
}

export default ImageGallery;
