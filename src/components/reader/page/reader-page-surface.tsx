import { useReaderPageController, type ReaderPageControllerProps } from "./reader-page-controller";
import { ReaderPageView } from "./reader-page-view";

export type ReaderPageSurfaceProps = ReaderPageControllerProps;

export function ReaderPageSurface(props: ReaderPageSurfaceProps) {
  return <ReaderPageView {...useReaderPageController(props)} />;
}
