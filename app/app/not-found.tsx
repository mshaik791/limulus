import { EmptyState } from "@/components/ui";

export default function NotFound() {
  return <EmptyState title="No such record." body="The id in the address does not match anything the engine has sealed." cta="Back to Labs" ctaHref="/labs" />;
}
