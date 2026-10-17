import { createFileRoute, notFound, useRouteContext } from "@tanstack/react-router";

import { AuthorPage } from "@/components/novels/authors/author-page";
import { prefetchCatalogFirstPage } from "@/components/novels/library/library-query";
import { authorCatalogFilters } from "@/components/novels/library/library-search";
import { hasAdminRole } from "@/lib/auth/roles";
import { getAuthor } from "@/lib/content/novel/author.functions";
import { headTranslator } from "@/lib/i18n/route-head";

/**
 * One author's shelf inside the catalog.
 *
 * The loader reports a missing author as a missing page rather than as a failure, which is
 * the same rule the novel page follows: a read that finds nothing is `notFound()`, and a
 * read that breaks stays a break. Everything else is the catalog with one filter applied.
 */
export const Route = createFileRoute("/{-$locale}/_public/authors/$authorId/")({
  loader: async ({ context, params }) => {
    const author = await getAuthor({ data: { authorId: params.authorId } });
    if (!author) throw notFound();
    await prefetchCatalogFirstPage(
      context.queryClient,
      "public",
      authorCatalogFilters(context.locale, author.id),
    );
    return { author };
  },
  head: async ({ loaderData }) => {
    const t = await headTranslator();
    const name = loaderData?.author.name;
    return {
      meta: [
        {
          title: name
            ? `${name} | ${t("meta.siteName")}`
            : `${t("meta.catalog")} | ${t("meta.siteName")}`,
        },
        {
          name: "description",
          content: name ? t("meta.authorDescription", { name }) : t("meta.catalogDescription"),
        },
      ],
    };
  },
  component: AuthorRoute,
});

function AuthorRoute() {
  const { author } = Route.useLoaderData();
  // Read from the root match, like every other page: signing out while this page is open
  // has to drop the operator control with the session.
  const { user } = useRouteContext({ from: "__root__" });

  return <AuthorPage author={author} isOperator={hasAdminRole(user?.role)} />;
}
