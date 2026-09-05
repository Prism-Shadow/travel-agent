/** Default account portrait; the surrounding account control supplies the accessible name. */
export function UserAvatar({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src="/user-avatar.png"
      alt=""
      aria-hidden
      draggable={false}
      width={size}
      height={size}
      className={`block shrink-0 select-none rounded-full bg-[#EEF4FF] object-cover ring-1 ring-black/5 dark:ring-white/10 ${className}`}
    />
  );
}
