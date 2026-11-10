// Utility for school logo presets and client-side canvas compression

export interface LogoPreset {
  id: string;
  name: string;
  category: string;
  description: string;
  dataUrl: string;
}

export const SCHOOL_NAME_PRESETS = [
  'SMK BISA HEBAT NUSANTARA',
  'SMA NEGERI 1 TELADAN',
  'SMP NEGERI 1 UNGGULAN',
  'SD NEGERI 1 INTI',
  'MAN 1 MODEL NUSANTARA',
  'SMK TEKNOLOGI INFORMATIKA',
  'SMA ISLAM TERPADU HARAPAN',
  'SMK NEGERI 2 KREATIF',
];

// High-fidelity vector SVG logos encoded as clean data URLs
export const SCHOOL_LOGO_PRESETS: LogoPreset[] = [
  {
    id: 'kemendikbud',
    name: 'Pendidikan Nasional (Tut Wuri)',
    category: 'Nasional',
    description: 'Logo simbol pendidikan nasional Indonesia dengan sayap dan obor',
    dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r="76" fill="#1e3a8a" stroke="#fbbf24" stroke-width="5"/>
        <circle cx="80" cy="80" r="68" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="3,3"/>
        <path d="M80 28 L98 52 L78 68 L82 72 L62 52 Z" fill="#f59e0b" opacity="0.9"/>
        <!-- Golden Torch & Flame -->
        <path d="M80 32 C72 45, 68 55, 74 65 C77 70, 83 70, 86 65 C92 55, 88 45, 80 32 Z" fill="#ef4444"/>
        <path d="M80 40 C76 48, 74 54, 78 60 C80 63, 83 63, 85 60 C88 54, 86 48, 80 40 Z" fill="#fbbf24"/>
        <polygon points="76,68 84,68 82,90 78,90" fill="#f59e0b"/>
        <!-- Wings -->
        <path d="M80 82 C65 72, 40 76, 32 94 C46 95, 60 90, 74 86 Z" fill="#ffffff"/>
        <path d="M80 82 C95 72, 120 76, 128 94 C114 95, 100 90, 86 86 Z" fill="#ffffff"/>
        <path d="M80 88 C68 82, 48 86, 40 102 C54 102, 66 97, 76 93 Z" fill="#93c5fd"/>
        <path d="M80 88 C92 82, 112 86, 120 102 C106 102, 94 97, 84 93 Z" fill="#93c5fd"/>
        <!-- Open Book Base -->
        <path d="M80 96 C70 91, 50 92, 36 102 L36 114 C52 105, 68 106, 80 114 C92 106, 108 105, 124 114 L124 102 C110 92, 90 91, 80 96 Z" fill="#f8fafc" stroke="#1e293b" stroke-width="1.5"/>
        <line x1="80" y1="96" x2="80" y2="122" stroke="#1e293b" stroke-width="2"/>
        <!-- Text Arc -->
        <text x="80" y="142" font-family="Arial, sans-serif" font-size="9" font-weight="bold" fill="#f8fafc" text-anchor="middle" letter-spacing="1">TUT WURI HANDAYANI</text>
      </svg>
    `)}`,
  },
  {
    id: 'academic_crest',
    name: 'Academic Crest & Bintang Keunggulan',
    category: 'Modern',
    description: 'Lambang perisai modern dengan bintang prestasi dan dedikasi',
    dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
        <defs>
          <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0f172a"/>
            <stop offset="100%" stop-color="#1e293b"/>
          </linearGradient>
          <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fcd34d"/>
            <stop offset="100%" stop-color="#d97706"/>
          </linearGradient>
        </defs>
        <!-- Shield Contour -->
        <path d="M80 18 L130 35 C130 95, 80 138, 80 144 C80 138, 30 95, 30 35 Z" fill="url(#shieldGrad)" stroke="url(#goldGrad)" stroke-width="4.5"/>
        <path d="M80 26 L122 41 C122 90, 80 128, 80 133 C80 128, 38 90, 38 41 Z" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.3"/>
        <!-- Star of Excellence -->
        <polygon points="80,42 84,54 96,54 86,62 90,74 80,66 70,74 74,62 64,54 76,54" fill="url(#goldGrad)"/>
        <!-- Laurel Leaves -->
        <path d="M52 85 C52 75, 60 70, 68 76 C62 82, 58 88, 52 85 Z" fill="#fcd34d"/>
        <path d="M108 85 C108 75, 100 70, 92 76 C98 82, 102 88, 108 85 Z" fill="#fcd34d"/>
        <!-- Open Book -->
        <path d="M80 82 C72 78, 58 80, 48 88 L48 108 C60 100, 72 100, 80 106 C88 100, 100 100, 112 108 L112 88 C102 80, 88 78, 80 82 Z" fill="#ffffff" stroke="#94a3b8" stroke-width="1.5"/>
        <line x1="80" y1="82" x2="80" y2="114" stroke="#0f172a" stroke-width="2"/>
        <text x="80" y="125" font-family="Arial, sans-serif" font-size="8" font-weight="900" fill="#fcd34d" text-anchor="middle" letter-spacing="1.5">EXCELLENCE</text>
      </svg>
    `)}`,
  },
  {
    id: 'tech_vocational',
    name: 'SMK Teknologi & Vokasi Terampil',
    category: 'Vokasi / SMK',
    description: 'Simbol roda gigi industri, sirkuit digital, dan kemahiran terampil',
    dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
        <defs>
          <linearGradient id="techGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0284c7"/>
            <stop offset="100%" stop-color="#0369a1"/>
          </linearGradient>
        </defs>
        <circle cx="80" cy="80" r="74" fill="url(#techGrad)" stroke="#38bdf8" stroke-width="4"/>
        <circle cx="80" cy="80" r="62" fill="#0f172a"/>
        <!-- Cogwheel Silhouette -->
        <path d="M80 34 L86 34 L88 44 C92 45, 96 47, 100 50 L108 44 L114 49 L110 58 C113 61, 115 65, 117 70 L126 71 L126 79 L117 80 C115 85, 113 89, 110 92 L114 101 L108 106 L100 100 C96 103, 92 105, 88 106 L86 116 L74 116 L72 106 C68 105, 64 103, 60 100 L52 106 L46 101 L50 92 C47 89, 45 85, 43 80 L34 79 L34 71 L43 70 C45 65, 47 61, 50 58 L46 49 L52 44 L60 50 C64 47, 68 45, 72 44 L74 34 Z" fill="#38bdf8" opacity="0.85"/>
        <circle cx="80" cy="75" r="22" fill="#0f172a" stroke="#f8fafc" stroke-width="2.5"/>
        <!-- Lightbulb / Idea / Pen -->
        <path d="M80 60 C73 60, 68 65, 68 72 C68 77, 72 80, 75 83 L85 83 C88 80, 92 77, 92 72 C92 65, 87 60, 80 60 Z" fill="#facc15"/>
        <rect x="76" y="85" width="8" height="4" rx="1" fill="#94a3b8"/>
        <!-- Text -->
        <text x="80" y="142" font-family="Arial, sans-serif" font-size="9" font-weight="bold" fill="#38bdf8" text-anchor="middle" letter-spacing="1">SMK BISA - HEBAT</text>
      </svg>
    `)}`,
  },
  {
    id: 'madrasah_islami',
    name: 'Madrasah & Lembaga Pendidikan Hijau',
    category: 'Kemenag / Madrasah',
    description: 'Lambang hijau bernuansa Islami dengan bintang, kitab, dan pena',
    dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
        <defs>
          <linearGradient id="greenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#047857"/>
            <stop offset="100%" stop-color="#065f46"/>
          </linearGradient>
        </defs>
        <circle cx="80" cy="80" r="74" fill="url(#greenGrad)" stroke="#fbbf24" stroke-width="4"/>
        <circle cx="80" cy="80" r="64" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="4,4"/>
        <!-- Eight-pointed Star (Islamic Star) -->
        <polygon points="80,30 92,42 108,36 104,52 118,62 106,72 112,88 96,86 88,100 80,88 64,100 56,86 40,88 46,72 34,62 48,52 44,36 60,42" fill="#064e3b" stroke="#fbbf24" stroke-width="2"/>
        <!-- Central Golden Star -->
        <polygon points="80,48 83,56 92,56 85,61 88,70 80,64 72,70 75,61 68,56 77,56" fill="#fbbf24"/>
        <!-- Open Holy Quran / Book -->
        <path d="M80 82 C72 78, 56 80, 44 88 L44 108 C58 100, 72 100, 80 106 C88 100, 102 100, 116 108 L116 88 C104 80, 88 78, 80 82 Z" fill="#ffffff" stroke="#1f2937" stroke-width="1.5"/>
        <line x1="80" y1="82" x2="80" y2="114" stroke="#1f2937" stroke-width="2"/>
        <!-- Text -->
        <text x="80" y="142" font-family="Arial, sans-serif" font-size="8.5" font-weight="bold" fill="#fbbf24" text-anchor="middle" letter-spacing="1">IKHLAS BERAMAL</text>
      </svg>
    `)}`,
  },
];

/**
 * Optimizes and compresses any uploaded image file (PNG, JPG, SVG, WebP)
 * to a base64 Data URL (max 512x512 pixels), maintaining transparency and quality.
 */
export async function compressImageFile(file: File, maxDimension = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    // If it's an SVG, read directly as data URL to preserve sharp vector rendering
    if (file.type === 'image/svg+xml') {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Gagal membaca file SVG'));
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }

        // Keep alpha transparency for logos
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to high-quality PNG or WebP data URL
        const dataUrl = canvas.toDataURL('image/png', 0.92);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Gagal memproses gambar'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Gagal membaca file gambar'));
    reader.readAsDataURL(file);
  });
}
