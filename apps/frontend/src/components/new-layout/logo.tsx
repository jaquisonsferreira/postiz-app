'use client';

export const Logo = () => {
  return (
    <span
      aria-label="Pauta"
      className="w-[46px] h-[46px] rounded-[14px] bg-accent text-accentInk flex items-center justify-center"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M6 19V13M12 19V5M18 19v-9" />
      </svg>
    </span>
  );
};
