import { useState, useMemo } from "react";
import { Check, ChevronsUpDown, FolderIcon, Loader2, X } from "lucide-react";
import { cn } from "@/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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

  const currentFolderId = value.id;
  const selectedFolder = currentFolderId
    ? findFolderById(folders, currentFolderId)
    : null;

  // Flatten folders for better UI rendering and performance
  const flattenedFolders = useMemo(() => flattenFolders(folders), [folders]);

  const filteredFolders =
    searchQuery.trim() === ""
      ? flattenedFolders
      : flattenedFolders.filter(
          ({ folder, displayPath }) =>
            folder.displayName
              .toLowerCase()
              .includes(searchQuery.toLowerCase()) ||
            displayPath.toLowerCase().includes(searchQuery.toLowerCase()),
        );

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
      setOpen(false);
    }
  };

  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
            disabled={isLoading}
          >
            <div className="flex items-center gap-2 flex-1">
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading folders...</span>
                </>
              ) : value.id ? (
                <div className="flex items-center gap-2">
                  <FolderIcon className="h-4 w-4" />
                  <span>{value.name || selectedFolder?.displayName || ""}</span>
                </div>
              ) : (
                placeholder
              )}
            </div>
            <div className="flex items-center gap-1">
              {value.id && !isLoading && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChangeValue({ name: "", id: "" });
                  }}
                  title="Clear folder selection"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
              <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command shouldFilter={false} className="overflow-visible">
            <CommandInput
              placeholder="Search folders..."
              value={searchQuery}
              onValueChange={setSearchQuery}
              className="border-b"
            />
            <CommandList
              className="max-h-[400px] overflow-y-scroll"
              style={{
                scrollbarWidth: "thin",
                scrollbarColor: "#cbd5e1 #f1f5f9",
              }}
            >
              {isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span>Loading folders...</span>
                </div>
              ) : filteredFolders.length === 0 ? (
                <CommandEmpty>No folder found.</CommandEmpty>
              ) : (
                <CommandGroup className="overflow-visible">
                  {filteredFolders.map(({ folder, displayPath, depth }) => (
                    <CommandItem
                      key={folder.id}
                      value={folder.id}
                      onSelect={() => handleFolderSelect(folder.id)}
                      className={cn(
                        value.id === folder.id &&
                          "bg-slate-100 dark:bg-slate-800",
                      )}
                      style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4 flex-shrink-0",
                          value.id === folder.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="flex items-center gap-2 flex-1 truncate">
                        <FolderIcon className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate text-sm">
                          {folder.displayName}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error && (
        <div className="mt-1 text-sm text-red-600 dark:text-red-400">
          {error.message}
        </div>
      )}
    </div>
  );
}
