export class JumpscareSystem {
  constructor(game) {
    this.g = game;
    this.active = false;

    this.duration = 350; // milliseconds

    this.images = [
      './assets/jumpscares/jumpscare1.jpg',
      './assets/jumpscares/jumpscare2.jpg',
      './assets/jumpscares/jumpscare3.jpg'
    ];

    this._createStyle();
  }

  trigger() {
    if (this.active || this.g.dead) return;

    this.active = true;

    // Random jumpscare
    const image =
      this.images[Math.floor(Math.random() * this.images.length)];

    const overlay = document.createElement('div');

    overlay.className = 'jumpscare-overlay';

    overlay.style.backgroundImage = `url("${image}")`;

    document.body.appendChild(overlay);

    // Force animation restart
    void overlay.offsetWidth;

    overlay.classList.add('jumpscare-active');

    // Audio
    this.playAudio();

    // Kill/reset after scare
    setTimeout(() => {
      overlay.remove();
      this.active = false;

      if (typeof this.g.newLevel === 'function') {
        this.g.newLevel();
      }
    }, this.duration);
  }

  playAudio() {
    // Uses your existing audio system if available.
    if (this.g.audio?.jumpIntro) {
      this.g.audio.jumpIntro();
    }
  }

  _createStyle() {
    if (document.getElementById('jumpscare-style')) return;

    const style = document.createElement('style');

    style.id = 'jumpscare-style';

    style.textContent = `
      .jumpscare-overlay {
        position: fixed;
        inset: 0;
        z-index: 999999;

        pointer-events: none;

        background-color: #000;
        background-repeat: no-repeat;
        background-position: center;
        background-size: cover;

        opacity: 0;

        transform: scale(1.08);

        will-change: transform, opacity;

        image-rendering: auto;
      }

      .jumpscare-overlay.jumpscare-active {
        animation: jumpscareFlash 350ms steps(1) forwards;
      }

      @keyframes jumpscareFlash {
        0% {
          opacity: 0;
          transform:
            scale(1.08)
            translate3d(0, 0, 0);
        }

        8% {
          opacity: 1;
          transform:
            scale(1.16)
            translate3d(-10px, 6px, 0);
        }

        16% {
          transform:
            scale(1.22)
            translate3d(9px, -7px, 0);
        }

        24% {
          transform:
            scale(1.18)
            translate3d(-7px, -4px, 0);
        }

        32% {
          transform:
            scale(1.25)
            translate3d(8px, 8px, 0);
        }

        40% {
          transform:
            scale(1.20)
            translate3d(-5px, 3px, 0);
        }

        50% {
          transform:
            scale(1.27)
            translate3d(6px, -6px, 0);
        }

        65% {
          transform:
            scale(1.22)
            translate3d(-3px, 5px, 0);
        }

        80% {
          transform:
            scale(1.25)
            translate3d(3px, -3px, 0);
        }

        100% {
          opacity: 1;
          transform:
            scale(1.28)
            translate3d(0, 0, 0);
        }
      }
    `;

    document.head.appendChild(style);
  }
}