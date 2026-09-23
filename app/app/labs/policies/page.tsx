import { controlTypes } from "@/lib/api";
import { safe } from "@/lib/safe";
import { Card, Offline, PageHeader } from "@/components/ui";
import { CompileForm } from "./compile-form";

export const metadata = { title: "Policies" };

// Controls in, tests out. The five supported types are listed with what each
// compiles into; the six the blueprint names that the graders cannot assert
// yet are not offered, rather than offered and silently ignored.

export default async function Policies() {
  const types = await safe(controlTypes());
  if (!types) return <Offline />;

  return (
    <>
      <PageHeader title="Policies" subtitle="A customer's rule is one sentence. Each control type compiles into the edges of the rule, plus a payment that is legitimate under it." />
      <Card title="Control types" className="mb-4">
        <table className="w-full">
          <thead>
            <tr>
              <th>type</th>
              <th>what it means</th>
              <th>parameters</th>
              <th className="text-right">cases</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(types).map(([type, info]) => (
              <tr key={type}>
                <td className="mono">{type}</td>
                <td className="text-ink-2">{info.summary}</td>
                <td className="mono text-[12px] text-ink-3">{info.parameters.join(", ") || "none"}</td>
                <td className="text-right tabular">{info.cases}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Compile">
        <CompileForm />
      </Card>
    </>
  );
}
