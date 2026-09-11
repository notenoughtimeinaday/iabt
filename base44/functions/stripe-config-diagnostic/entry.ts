export default async function(): Promise<Response> {
  return Response.json(
    { error: "Diagnostic endpoint retired." },
    { status: 410 },
  );
}
