const oklch = (token) => `oklch(var(${token}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Semantic scale names stay available even before the first usage lands in source.
  safelist: [
    'text-caption',
    'text-control',
    'text-body',
    'text-field',
    'text-subheading',
    'text-heading',
    'text-display',
  ],
  theme: {
    extend: {
      colors: {
        border: oklch('--border'),
        input: oklch('--input'),
        ring: oklch('--ring'),
        background: oklch('--background'),
        foreground: oklch('--foreground'),
        canvas: oklch('--canvas'),
        surface: {
          DEFAULT: oklch('--surface'),
          raised: oklch('--surface-raised'),
        },
        structural: oklch('--structural'),
        brand: {
          accent: oklch('--brand-accent'),
        },
        electric: oklch('--brand-primary'),
        action: oklch('--brand-primary'),
        // สีแบรนด์สำหรับตัวหนังสือ (เลขที่ใบงาน ลิงก์ในตาราง) — เข้มกว่าสีปุ่มเพื่อให้อ่านออก
        link: oklch('--brand-link'),
        // "ไม่ทราบสถานะ" มีสีของตัวเอง แยกจาก muted ที่เป็นสีของข้อความรอง
        unknown: oklch('--status-unknown'),
        primary: {
          DEFAULT: oklch('--primary'),
          foreground: oklch('--primary-foreground'),
        },
        secondary: {
          DEFAULT: oklch('--secondary'),
          foreground: oklch('--secondary-foreground'),
        },
        destructive: {
          DEFAULT: oklch('--destructive'),
          foreground: oklch('--destructive-foreground'),
        },
        info: {
          DEFAULT: oklch('--info'),
          foreground: oklch('--info-foreground'),
        },
        success: {
          DEFAULT: oklch('--success'),
          foreground: oklch('--success-foreground'),
        },
        warning: {
          DEFAULT: oklch('--warning'),
          foreground: oklch('--warning-foreground'),
        },
        chart: {
          1: oklch('--chart-1'),
          2: oklch('--chart-2'),
          3: oklch('--chart-3'),
        },
        muted: {
          DEFAULT: oklch('--muted'),
          foreground: oklch('--muted-foreground'),
        },
        accent: {
          DEFAULT: oklch('--accent'),
          foreground: oklch('--accent-foreground'),
        },
        popover: {
          DEFAULT: oklch('--popover'),
          foreground: oklch('--popover-foreground'),
        },
        card: {
          DEFAULT: oklch('--card'),
          foreground: oklch('--card-foreground'),
        },
        sidebar: {
          DEFAULT: oklch('--sidebar'),
          foreground: oklch('--sidebar-foreground'),
          group: oklch('--sidebar-group'),
          icon: oklch('--sidebar-icon'),
          hover: oklch('--sidebar-hover'),
          'hover-foreground': oklch('--sidebar-hover-foreground'),
          active: oklch('--sidebar-active'),
          'active-foreground': oklch('--sidebar-active-foreground'),
          indicator: oklch('--sidebar-indicator'),
          disabled: oklch('--sidebar-disabled'),
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'var(--radius-medium)',
        sm: 'var(--radius-small)',
        xl: 'var(--radius-panel)',
        '2xl': 'var(--radius-large)',
      },
      spacing: {
        2: 'var(--space-inline)',
        3: 'var(--space-control)',
        4: 'var(--space-panel)',
        6: 'var(--space-section)',
        8: 'var(--space-page)',
      },
      boxShadow: {
        sm: 'var(--shadow-low)',
        md: 'var(--shadow-medium)',
        lg: 'var(--shadow-high)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      // Product type scale — บทความและข้อความอธิบายเริ่มที่ 16/24 เพื่อรองรับภาษาไทย
      // ส่วน label/control และ metadata ยังมีขั้น 14/20 และ 12/18 สำหรับหน้าปฏิบัติการ
      // ที่ต้องคงความหนาแน่น · input คง 16px เพื่อไม่ให้ iOS Safari ซูมเมื่อโฟกัส
      // ชื่อ t-shirt เดิมถูกแม็พเข้าบทบาทเดียวกันเพื่อไม่ให้แต่ละหน้าสร้างสเกลใหม่เอง
      fontSize: {
        caption: ['12px', { lineHeight: '18px' }],
        control: ['14px', { lineHeight: '20px' }],
        body: ['16px', { lineHeight: '24px' }],
        field: ['16px', { lineHeight: '24px' }],
        subheading: ['18px', { lineHeight: '24px' }],
        heading: ['22px', { lineHeight: '28px' }],
        display: ['28px', { lineHeight: '36px' }],
        xs: ['12px', { lineHeight: '18px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['16px', { lineHeight: '24px' }],
        lg: ['18px', { lineHeight: '24px' }],
        xl: ['18px', { lineHeight: '24px' }],
        '2xl': ['22px', { lineHeight: '28px' }],
        '3xl': ['28px', { lineHeight: '36px' }],
        '4xl': ['28px', { lineHeight: '36px' }],
      },
      zIndex: {
        header: '30',
        'drawer-backdrop': '40',
        drawer: '50',
        /**
         * รายการของ combobox/dropdown ที่ portal ไปที่ body — ต้อง **สูงกว่า `drawer`**
         * เพราะ dialog ก็ใช้ `z-drawer` และ dropdown ที่เปิดในนั้นต้องอยู่บนสุด ·
         * ยังต่ำกว่า `toast` โดยเจตนา (การแจ้งเตือนต้องไม่ถูกรายการเลือกทับ)
         */
        popover: '55',
        toast: '60',
        tooltip: '70',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
