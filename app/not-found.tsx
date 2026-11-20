import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-[420px] flex-col items-center gap-4 px-4 py-24 text-center text-[14px]">
      <p>Nothing here.</p>
      <Link className="btn" href="/">
        Home
      </Link>
    </main>
  );
}
