import { InjectionToken } from '@gitbutler/shared/context';
import { reactive } from '@gitbutler/shared/reactiveUtils.svelte';
import { type Reactive } from '@gitbutler/shared/storeUtils';
import { mergeUnlisten } from '@gitbutler/ui/utils/mergeUnlisten';
import { on } from 'svelte/events';

export const FOCUS_MANAGER = new InjectionToken<FocusManager>('FocusManager');

export enum DefinedFocusable {
	MainViewport = 'workspace',
	ViewportLeft = 'workspace-left',
	ViewportRight = 'workspace-right',
	ViewportDrawerRight = 'workspace-drawer-right',
	ViewportMiddle = 'workspace-middle',
	UncommittedChanges = 'uncommitted-changes',
	Drawer = 'drawer',
	Branches = 'branches',
	Stack = 'stack',
	Preview = 'preview',
	ChangedFiles = 'changed-files'
}

// Improved ID system with better typing and validation
const ID_SEPARATOR = '::' as const; // Less likely to conflict than ':'
const ID_PREFIX = {
	STACK: 'stack',
	UNCOMMITTED: 'uncommitted'
} as const;

type IdPrefix = typeof ID_PREFIX[keyof typeof ID_PREFIX];

// Validate that a string is a valid DefinedFocusable
function isDefinedFocusable(value: string): value is DefinedFocusable {
	return Object.values(DefinedFocusable).includes(value as DefinedFocusable);
}

// Type-safe ID construction functions
export function createStackId(stackId: string): string {
	if (!stackId.trim()) throw new Error('Stack ID cannot be empty');
	return `${ID_PREFIX.STACK}${ID_SEPARATOR}${stackId}`;
}

export function createUncommittedId(stackId?: string): string {
	if (stackId !== undefined && !stackId.trim()) throw new Error('Stack ID cannot be empty');
	return stackId 
		? `${ID_PREFIX.UNCOMMITTED}${ID_SEPARATOR}${stackId}`
		: ID_PREFIX.UNCOMMITTED;
}

// Improved parsing with validation
export interface ParsedFocusableId {
	prefix: IdPrefix;
	suffix: string;
	originalId: string;
}

export function parseFocusableId(id: string): ParsedFocusableId | null {
	if (isDefinedFocusable(id)) {
		return null; // Simple defined focusable, no parsing needed
	}

	const separatorIndex = id.indexOf(ID_SEPARATOR);
	if (separatorIndex === -1) {
		return null; // No separator found
	}

	const prefix = id.substring(0, separatorIndex);
	const suffix = id.substring(separatorIndex + ID_SEPARATOR.length);

	// Validate prefix
	if (!Object.values(ID_PREFIX).includes(prefix as IdPrefix)) {
		return null; // Unknown prefix
	}

	return {
		prefix: prefix as IdPrefix,
		suffix,
		originalId: id
	};
}

// Extract stack ID from composite IDs
export function extractStackId(id: string): string | null {
	const parsed = parseFocusableId(id);
	return parsed?.suffix || null;
}

export type Focusable = DefinedFocusable | string;

export interface FocusableElement {
	readonly key: Focusable;
	readonly element: HTMLElement;
	parentId: Focusable | null;
	readonly children: Set<Focusable>; // Use Set to prevent duplicates
}

/**
 * Refactored FocusManager with improved performance and reliability.
 *
 * Key improvements:
 * - Map-based registry for O(1) lookups
 * - Proper duplicate ID handling
 * - Robust ID parsing and validation
 * - Better parent-child relationship management
 * - Type-safe ID construction
 */
export class FocusManager implements Reactive<Focusable | undefined> {
	// Map-based registry for O(1) lookups
	private elements = new Map<Focusable, FocusableElement>();
	private elementLookup = new Map<HTMLElement, FocusableElement>();
	
	private _current: Focusable | undefined = $state();

	private handleMouse = this.handleClick.bind(this);
	private handleKeys = this.handleKeydown.bind(this);

	constructor() {
		$effect(() => {
			return mergeUnlisten(
				on(document, 'click', this.handleMouse, { capture: true }),
				on(document, 'keypress', this.handleKeys)
			);
		});
	}

	get current() {
		return this._current;
	}

	handleClick(e: Event) {
		if (e.target instanceof HTMLElement) {
			let pointer: HTMLElement | null = e.target;
			while (pointer) {
				const item = this.elementLookup.get(pointer);
				if (item) {
					this.setActive(item.key);
					break;
				}
				pointer = pointer.parentElement;
			}
		}
	}

	register(id: Focusable, parentId: Focusable | null, element: HTMLElement) {
		// Validate the ID if it's a composite ID
		if (typeof id === 'string' && !isDefinedFocusable(id)) {
			const parsed = parseFocusableId(id);
			if (parsed === null && id.includes(ID_SEPARATOR)) {
				console.warn(`Invalid focusable ID format: ${id}`);
			}
		}

		// Remove old element if it exists
		const existingElement = this.elements.get(id);
		if (existingElement) {
			this.elementLookup.delete(existingElement.element);
			// Update parent relationship if changed
			if (existingElement.parentId !== parentId) {
				this.removeFromParent(id, existingElement.parentId);
				this.addToParent(id, parentId);
			}
			// Update the element reference
			existingElement.parentId = parentId;
			(existingElement as any).element = element; // Cast to bypass readonly
		} else {
			// Create new element
			const newElement: FocusableElement = {
				key: id,
				parentId,
				element,
				children: new Set()
			};
			this.elements.set(id, newElement);
			this.addToParent(id, parentId);
		}

		// Update lookup
		const currentElement = this.elements.get(id)!;
		this.elementLookup.set(element, currentElement);

		// Connect any orphaned children
		this.connectOrphanedChildren(id);
	}

	private addToParent(childId: Focusable, parentId: Focusable | null) {
		if (parentId !== null) {
			const parent = this.elements.get(parentId);
			if (parent) {
				parent.children.add(childId);
			}
		}
	}

	private removeFromParent(childId: Focusable, parentId: Focusable | null) {
		if (parentId !== null) {
			const parent = this.elements.get(parentId);
			if (parent) {
				parent.children.delete(childId);
			}
		}
	}

	private connectOrphanedChildren(parentId: Focusable) {
		// Find children that should belong to this parent
		for (const [id, element] of this.elements) {
			if (element.parentId === parentId && id !== parentId) {
				this.addToParent(id, parentId);
			}
		}
	}

	unregister(id: Focusable) {
		const element = this.elements.get(id);
		if (!element) return;

		// Remove from parent
		this.removeFromParent(id, element.parentId);

		// Clean up children references (they become orphaned)
		for (const childId of element.children) {
			const child = this.elements.get(childId);
			if (child && child.parentId === id) {
				child.parentId = null;
			}
		}

		// Remove from maps
		this.elements.delete(id);
		this.elementLookup.delete(element.element);

		// Clear current if it was this element
		if (this._current === id) {
			this._current = undefined;
		}
	}

	setActive(id: Focusable) {
		if (this.elements.has(id)) {
			this._current = id;
		}
	}

	focusSibling(forward = true) {
		const currentId = this._current;
		if (!currentId) return;

		const current = this.elements.get(currentId);
		if (!current?.parentId) return;

		const parent = this.elements.get(current.parentId);
		if (!parent) return;

		const siblings = Array.from(parent.children);
		const currentIndex = siblings.indexOf(currentId);
		if (currentIndex === -1) return;

		const nextIndex = forward 
			? (currentIndex + 1) % siblings.length
			: (currentIndex - 1 + siblings.length) % siblings.length;

		const nextSibling = siblings[nextIndex];
		if (nextSibling) {
			this.setActive(nextSibling);
			this.elements.get(nextSibling)?.element.focus();
		}
	}

	focusParent() {
		const currentId = this._current;
		if (!currentId) return;

		const current = this.elements.get(currentId);
		if (!current?.parentId) return;

		this.setActive(current.parentId);
		this.elements.get(current.parentId)?.element.focus();
	}

	focusFirstChild() {
		const currentId = this._current;
		if (!currentId) return;

		const current = this.elements.get(currentId);
		if (!current || current.children.size === 0) return;

		const firstChild = current.children.values().next().value;
		if (firstChild) {
			this.setActive(firstChild);
			this.elements.get(firstChild)?.element.focus();
		}
	}

	handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Tab') {
			event.preventDefault();
			this.focusSibling(!event.shiftKey);
		} else if (event.metaKey && event.key === 'ArrowUp') {
			event.preventDefault();
			this.focusParent();
		} else if (event.metaKey && event.key === 'ArrowDown') {
			event.preventDefault();
			this.focusFirstChild();
		}
	}

	/**
	 * Works like an HTML radio input group.
	 * 
	 * Improved with better performance and type safety.
	 */
	radioGroup(args: { triggers: Focusable[] }): Reactive<Focusable | undefined> {
		if (args.triggers.length < 2) {
			throw new Error('Radio group requires two or more triggers.');
		}

		// Validate triggers
		const validTriggers = args.triggers.filter(trigger => this.elements.has(trigger));
		if (validTriggers.length === 0) {
			console.warn('No valid triggers found in radio group');
			return reactive(() => undefined);
		}

		let current = $state(validTriggers[0]!);
		
		$effect(() => {
			let currentElement = this.elements.get(this._current || '');
			if (!currentElement) return;

			// Walk up the hierarchy to find a matching trigger
			let searchElement: FocusableElement | undefined = currentElement;
			while (searchElement) {
				if (args.triggers.includes(searchElement.key)) {
					current = searchElement.key;
					break;
				}
				searchElement = searchElement.parentId ? this.elements.get(searchElement.parentId) : undefined;
			}
		});

		return reactive(() => current);
	}

	// Utility methods for debugging and inspection
	getElementInfo(id: Focusable): FocusableElement | undefined {
		return this.elements.get(id);
	}

	getAllElements(): ReadonlyMap<Focusable, FocusableElement> {
		return this.elements;
	}

	getHierarchy(): Record<string, string[]> {
		const result: Record<string, string[]> = {};
		for (const [id, element] of this.elements) {
			result[String(id)] = Array.from(element.children).map(String);
		}
		return result;
	}
}