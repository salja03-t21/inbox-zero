export function MinimalLayout(props: { children: React.ReactNode }) {
  return (
    <div className="bg-white">
      <main className="isolate">{props.children}</main>
    </div>
  );
}
