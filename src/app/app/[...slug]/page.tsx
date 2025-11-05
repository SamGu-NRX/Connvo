import { redirect } from "next/navigation";

type PageProps = {
  params: {
    slug: string[];
  };
  searchParams?: Record<string, string | string[] | undefined>;
};

function buildSearch(searchParams?: Record<string, string | string[] | undefined>) {
  if (!searchParams) return "";

  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry !== undefined) {
          query.append(key, entry);
        }
      });
    } else {
      query.append(key, value);
    }
  }

  const queryString = query.toString();
  return queryString ? `?${queryString}` : "";
}

export default function AppRedirectPage({ params, searchParams }: PageProps) {
  const segments = params.slug;
  const destinationBase = `/mvp/${segments.join("/")}`;

  const search = buildSearch(searchParams);

  redirect(`${destinationBase}${search}`);
}
