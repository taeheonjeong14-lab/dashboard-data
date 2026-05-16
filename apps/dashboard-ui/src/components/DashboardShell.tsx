import AppNav from "@/components/AppNav";

type Props = {
  children: React.ReactNode;
};

export default function DashboardShell({ children }: Props) {
  return (
    <div className="min-h-screen bg-zinc-950">
      <AppNav />
      {children}
    </div>
  );
}
