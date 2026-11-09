import psdDarkLogo from '@/assets/logo/psd-dark.png';

export function BrandMark({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex min-h-14 shrink-0 items-center justify-center border-b border-sidebar-hover px-3">
      <img
        src={psdDarkLogo}
        alt="PSD Sentinel"
        width={932}
        height={235}
        className={`h-auto shrink-0 object-contain ${
          collapsed ? 'max-h-7 w-12' : 'max-h-9 w-32'
        }`}
      />
    </div>
  );
}
