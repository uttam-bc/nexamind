/**
 * Client-side user avatar storage and optimization helper (Option B).
 * Allows users to upload and preview profile pictures, resize/crop them to square WebP/JPEG,
 * and persist them locally without requiring backend schema alterations.
 */

const STORAGE_PREFIX = 'nexamind_custom_avatar_';
const memoryStore = new Map();

function getStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.getItem === 'function') {
      return window.localStorage;
    }
  } catch {
    /* fallback to memoryStore */
  }
  return {
    getItem: (key) => (memoryStore.has(key) ? memoryStore.get(key) : null),
    setItem: (key, val) => memoryStore.set(key, String(val)),
    removeItem: (key) => memoryStore.delete(key),
    clear: () => memoryStore.clear(),
  };
}

export function getStoredAvatar(userId) {
  if (!userId) return null;
  try {
    return getStorage().getItem(`${STORAGE_PREFIX}${userId}`) || null;
  } catch {
    return null;
  }
}

export function setStoredAvatar(userId, dataUrl) {
  if (!userId) return;
  try {
    const storage = getStorage();
    if (dataUrl) {
      storage.setItem(`${STORAGE_PREFIX}${userId}`, dataUrl);
    } else {
      storage.removeItem(`${STORAGE_PREFIX}${userId}`);
    }
    // Broadcast event for multi-component real-time UI synchronization
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent('nexamind:avatar-updated', {
          detail: { userId, avatarUrl: dataUrl || null },
        })
      );
    }
  } catch (err) {
    console.error('Failed to store avatar', err);
  }
}

export function removeStoredAvatar(userId) {
  setStoredAvatar(userId, null);
}

/**
 * Validates, center-crops to square, and resizes an uploaded image file.
 * Returns a Promise that resolves to a compact data URL.
 */
export function processAvatarFile(file, maxDimension = 256) {
  return new Promise((resolve, reject) => {
    if (!file) {
      return reject(new Error('No file selected'));
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      return reject(new Error('Please select a valid image file (JPEG, PNG, WebP, or GIF).'));
    }

    // 5MB file size limit
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return reject(new Error('Image file is too large. Please select an image under 5MB.'));
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode image data.'));
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const size = Math.min(maxDimension, Math.max(img.width, img.height));
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');

          // Center-crop calculation (square)
          const minSide = Math.min(img.width, img.height);
          const startX = (img.width - minSide) / 2;
          const startY = (img.height - minSide) / 2;

          ctx.drawImage(img, startX, startY, minSide, minSide, 0, 0, size, size);

          // Output as JPEG or WebP
          const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          const dataUrl = canvas.toDataURL(mime, 0.88);
          resolve(dataUrl);
        } catch (err) {
          reject(new Error('Failed to process image: ' + err.message));
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
