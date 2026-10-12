"use client";
import { Editor } from "./Editor";
import { RecordButton } from "./RecordButton";
import { canEdit } from "@/lib/roles";

type Props = Omit<React.ComponentProps<typeof Editor>, "toolbarExtras">;

export function ProjectEditor(props: Props) {
  return (
    <Editor
      {...props}
      toolbarExtras={({ approved, steps, parts, project }) => (
        <RecordButton project={project} steps={steps} parts={parts} modelUrl={props.modelUrl} approved={approved} canUpload={canEdit(props.role)} />
      )}
    />
  );
}
