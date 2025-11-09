import { useMemo } from "react";
import { FolderIcon, Loader2 } from "lucide-react";
import { cn } from "@/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FOLDER_SEPARATOR, type OutlookFolder } from "@/utils/outlook/folders";
import type { FieldError } from "react-hook-form";

/**
 * Recursively flatten folder hierarchy into a flat list of items for rendering
 * This avoids deeply nested DOM structures and improves performance
 */
function flattenFolders(
  folders: OutlookFolder[],
  parentPath = "",
  depth = 0,
): Array<{ folder: OutlookFolder; displayPath: string; depth: number }> {
  const result: Array<{
    folder: OutlookFolder;
    displayPath: string;
    depth: number;
  }> = [];

  for (const folder of folders) {
    const currentPath = parentPath
      ? `${parentPath}${FOLDER_SEPARATOR}${folder.displayName}`
      : folder.displayName;

    result.push({ folder, displayPath: currentPath, depth });

    if (folder.childFolders && folder.childFolders.length > 0) {
      result.push(
        ...flattenFolders(folder.childFolders, currentPath, depth + 1),
      );
    }
  }

  return result;
}

interface FolderSelectorProps {
  folders: OutlookFolder[];
  isLoading: boolean;
  value: { name: string; id: string };
  onChangeValue: (value: { name: string; id: string }) => void;
  placeholder?: string;
  error?: FieldError;
}

export function FolderSelector({
  folders,
  isLoading,
  value,
  onChangeValue,
  placeholder = "Select a folder...",
  error,
}: FolderSelectorProps) {
  const findFolderById = (
    folderList: OutlookFolder[],
    targetId: string,
  ): OutlookFolder | null => {
    for (const folder of folderList) {
      if (folder.id === targetId) {
        return folder;
      }
      if (folder.childFolders && folder.childFolders.length > 0) {
        const found = findFolderById(folder.childFolders, targetId);
        if (found) return found;
      }
    }
    return null;
  };

  // Flatten folders for better UI rendering and performance
  const flattenedFolders = useMemo(() => flattenFolders(folders), [folders]);

  const buildFolderPath = (folderId: string): string => {
    const folder = findFolderById(folders, folderId);
    if (!folder) return "";

    const findPath = (
      folderList: OutlookFolder[],
      targetId: string,
      currentPath: string[] = [],
    ): string[] | null => {
      for (const f of folderList) {
        const newPath = [...currentPath, f.displayName];

        if (f.id === targetId) {
          return newPath;
        }

        if (f.childFolders && f.childFolders.length > 0) {
          const result = findPath(f.childFolders, targetId, newPath);
          if (result) return result;
        }
      }
      return null;
    };

    const pathParts = findPath(folders, folderId);
    return pathParts ? pathParts.join(FOLDER_SEPARATOR) : folder.displayName;
  };

  const handleFolderSelect = (folderId: string) => {
    const folder = findFolderById(folders, folderId);
    if (folder) {
      const fullPath = buildFolderPath(folderId);
      onChangeValue({
        name: fullPath,
        id: folder.id,
      });
    }
  };

  return (
    <div>
      <Select
        value={value.id}
        onValueChange={handleFolderSelect}
        disabled={isLoading}
      >
        <SelectTrigger className="w-full">
          {isLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading folders...</span>
            </div>
          ) : (
            <SelectValue placeholder={placeholder}>
              {value.id ? (
                <div className="flex items-center gap-2">
                  <FolderIcon className="h-4 w-4" />
                  <span>{value.name}</span>
                </div>
              ) : (
                placeholder
              )}
            </SelectValue>
          )}
        </SelectTrigger>
        <SelectContent>
          {flattenedFolders.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No folders found
            </div>
          ) : (
            flattenedFolders.map(({ folder, depth }) => (
              <SelectItem
                key={folder.id}
                value={folder.id}
                className={cn("cursor-pointer", depth > 0 && "ml-4")}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
              >
                <div className="flex items-center gap-2">
                  <FolderIcon className="h-4 w-4 shrink-0" />
                  <span>{folder.displayName}</span>
                </div>
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      {error && (
        <div className="mt-1 text-sm text-red-600 dark:text-red-400">
          {error.message}
        </div>
      )}
    </div>
  );
}
