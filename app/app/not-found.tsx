import { EmptyState } from "@/components/ui";

export default function NotFound() {
  return <EmptyState title="There is no page at this address." body="Check the link, or go back to Test. A run, scenario or record that cannot be found says so on its own page." cta="Back to Test" ctaHref="/labs" />;
}
