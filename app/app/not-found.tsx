import Link from "next/link";
import { Empty } from "@/components/ui";

export default function NotFound() {
  return (
    <Empty>
      No such record. <Link href="/labs" className="text-accent-ink">Back to Labs</Link>
    </Empty>
  );
}
