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

export type Focusable = DefinedFocusable | string;

// Common payload types for type safety
export interface StackPayload {
	stackId: string;
	branchName?: string;
	isActive?: boolean;
}

export interface ItemPayload {
	itemId: string;
	index: number;
	data?: any;
}

export interface FilePayload {
	filePath: string;
	isModified?: boolean;
	lineCount?: number;
}

// Convenience factory functions for common use cases
export function createStackOptions<TPayload extends StackPayload>(
	parentId: Focusable,
	payload: TPayload,
	options?: Partial<FocusableOptions<TPayload>>
): FocusableOptions<TPayload> {
	return {
		id: 'stack',
		parentId,
		payload,
		displayName: `Stack: ${payload.stackId}`,
		tags: ['stack'],
		...options
	};
}

export function createItemOptions<TPayload extends ItemPayload>(
	parentId: Focusable,
	payload: TPayload,
	options?: Partial<FocusableOptions<TPayload>>
): FocusableOptions<TPayload> {
	return {
		id: 'item',
		parentId,
		payload,
		displayName: `Item ${payload.index}`,
		tabIndex: payload.index,
		tags: ['item'],
		...options
	};
}

export interface FocusContext<TPayload = any> {
	element: HTMLElement;
	logicalId: Focusable;
	payload: TPayload;
	manager: FocusManager;
}

export type KeyboardHandler<TPayload = any> = (event: KeyboardEvent, context: FocusContext<TPayload>) => boolean | void;

export interface FocusableOptions<TPayload = any> {
	id: Focusable;
	parentId?: Focusable | null;
	payload?: TPayload; // Type-safe arbitrary data
	// Event handlers
	onKeydown?: KeyboardHandler<TPayload>;
	onFocus?: (context: FocusContext<TPayload>) => void;
	onBlur?: (context: FocusContext<TPayload>) => void;
	// Navigation behavior
	priority?: number; // Higher priority elements are preferred when multiple candidates exist
	tabIndex?: number; // Custom tab order within siblings
	disabled?: boolean; // Skip this element during navigation
	// Metadata
	displayName?: string; // Human-readable name for debugging
	description?: string; // Additional context
	tags?: string[]; // Searchable tags
}

interface ElementMetadata<TPayload = any> {
	logicalId: Focusable;
	parentElement: HTMLElement | null;
	children: HTMLElement[]; // Preserve registration order
	// Track registration state
	registrationTime: number;
	// Extended options
	options: FocusableOptions<TPayload>;
}

interface PendingRelationship {
	childElement: HTMLElement;
	parentId: Focusable;
	registrationTime: number;
}

/**
 * Robust FocusManager that handles out-of-order registration using:
 * 1. Deferred linking for parent-child relationships
 * 2. DOM traversal as fallback for parent discovery
 * 3. Lazy resolution during navigation operations
 */
export class FocusManager implements Reactive<Focusable | undefined> {
	// Physical registry: element -> metadata
	private elementRegistry = new Map<HTMLElement, ElementMetadata<any>>();
	
	// Logical index: for queries and bulk operations (preserve registration order)
	private logicalIndex = new Map<Focusable, HTMLElement[]>();
	
	// Reverse lookup: element -> focusable for click handling
	private elementLookup = new Map<HTMLElement, HTMLElement>();
	
	// Deferred relationships: parent hasn't been registered yet
	private pendingRelationships: PendingRelationship[] = [];
	
	// Current focused element (physical)
	private _currentElement: HTMLElement | undefined = $state();
	
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

	// Helper methods for managing arrays without duplicates while preserving order
	private addToLogicalIndex(logicalId: Focusable, element: HTMLElement) {
		const array = this.logicalIndex.get(logicalId)!;
		if (!array.includes(element)) {
			array.push(element);
		}
	}

	private removeFromLogicalIndex(logicalId: Focusable, element: HTMLElement) {
		const array = this.logicalIndex.get(logicalId);
		if (array) {
			const index = array.indexOf(element);
			if (index !== -1) {
				array.splice(index, 1);
			}
		}
	}

	private addChild(parentMeta: ElementMetadata, childElement: HTMLElement) {
		if (!parentMeta.children.includes(childElement)) {
			parentMeta.children.push(childElement);
		}
	}

	private removeChild(parentMeta: ElementMetadata, childElement: HTMLElement) {
		const index = parentMeta.children.indexOf(childElement);
		if (index !== -1) {
			parentMeta.children.splice(index, 1);
		}
	}

	get current(): Focusable | undefined {
		if (!this._currentElement) return undefined;
		return this.elementRegistry.get(this._currentElement)?.logicalId;
	}

	handleClick(e: Event) {
		if (e.target instanceof HTMLElement) {
			let pointer: HTMLElement | null = e.target;
			while (pointer) {
				if (this.elementRegistry.has(pointer)) {
					this.setActive(pointer);
					break;
				}
				pointer = pointer.parentElement;
			}
		}
	}

	// Primary registration method with full options and type-safe payload
	register<TPayload = any>(options: FocusableOptions<TPayload>, element: HTMLElement): void;
	// Backwards compatible overload
	register(logicalId: Focusable, parentId: Focusable | null, element: HTMLElement): void;
	// Implementation
	register<TPayload = any>(
		optionsOrId: FocusableOptions<TPayload> | Focusable, 
		parentIdOrElement: Focusable | null | HTMLElement, 
		element?: HTMLElement
	) {
		let options: FocusableOptions<TPayload>;
		let targetElement: HTMLElement;

		// Handle overloads
		if (typeof optionsOrId === 'object' && 'id' in optionsOrId) {
			// New signature: register(options, element)
			options = optionsOrId;
			targetElement = parentIdOrElement as HTMLElement;
		} else {
			// Legacy signature: register(id, parentId, element)
			options = {
				id: optionsOrId as Focusable,
				parentId: parentIdOrElement as Focusable | null
			} as FocusableOptions<TPayload>;
			targetElement = element!;
		}

		this.doRegister(options, targetElement);
	}

	private doRegister<TPayload = any>(options: FocusableOptions<TPayload>, element: HTMLElement) {
		const registrationTime = Date.now();
		const { id: logicalId, parentId } = options;

		// Remove any existing registration for this element
		this.unregisterElement(element);

		// Try to find parent immediately
		let parentElement: HTMLElement | null = null;

		if (parentId) {
			// Strategy 1: Look for registered parent with matching logicalId
			parentElement = this.findRegisteredParent(parentId);

			// Strategy 2: If not found, traverse DOM to find parent
			if (!parentElement) {
				parentElement = this.findParentInDOM(element, parentId);
			}

			// Strategy 3: If still not found, defer the relationship
			if (!parentElement) {
				this.pendingRelationships.push({
					childElement: element,
					parentId,
					registrationTime
				});
			}
		}

		// Register the element
		const metadata: ElementMetadata = {
			logicalId,
			parentElement,
			children: [], // Preserve order
			registrationTime,
			options
		};

		this.elementRegistry.set(element, metadata);
		this.elementLookup.set(element, element);

		// Update logical index
		if (!this.logicalIndex.has(logicalId)) {
			this.logicalIndex.set(logicalId, []);
		}
		this.addToLogicalIndex(logicalId, element);

		// Link to parent if found
		if (parentElement) {
			const parentMeta = this.elementRegistry.get(parentElement);
			if (parentMeta) {
				this.addChild(parentMeta, element);
			}
		}

		// Try to resolve any pending relationships now that this element is registered
		this.resolvePendingRelationships(logicalId, element);

		// Trigger onFocus if this becomes the current element
		if (options.onFocus && this._currentElement === element) {
			options.onFocus(this.createContext(element, metadata));
		}
	}

	private createContext<TPayload = any>(element: HTMLElement, metadata: ElementMetadata<TPayload>): FocusContext<TPayload> {
		return {
			element,
			logicalId: metadata.logicalId,
			payload: metadata.options.payload as TPayload,
			manager: this
		};
	}

	private unregisterElement(element: HTMLElement) {
		const existing = this.elementRegistry.get(element);
		if (!existing) return;

		// Remove from logical index
		this.removeFromLogicalIndex(existing.logicalId, element);
		const logicalArray = this.logicalIndex.get(existing.logicalId);
		if (logicalArray && logicalArray.length === 0) {
			this.logicalIndex.delete(existing.logicalId);
		}

		// Remove from parent's children
		if (existing.parentElement) {
			const parentMeta = this.elementRegistry.get(existing.parentElement);
			if (parentMeta) {
				this.removeChild(parentMeta, element);
			}
		}

		// Orphan children (they might get reconnected later)
		for (const child of existing.children) {
			const childMeta = this.elementRegistry.get(child);
			if (childMeta) {
				childMeta.parentElement = null;
			}
		}

		this.elementRegistry.delete(element);
		this.elementLookup.delete(element);
	}

	private findRegisteredParent(parentId: Focusable): HTMLElement | null {
		const candidates = this.logicalIndex.get(parentId);
		if (!candidates || candidates.length === 0) return null;

		// If multiple candidates, prefer the most recently registered
		// (assumption: more recent registration is more relevant)
		let bestCandidate: HTMLElement | null = null;
		let bestTime = 0;

		for (const candidate of candidates) {
			const meta = this.elementRegistry.get(candidate);
			if (meta && meta.registrationTime > bestTime) {
				bestCandidate = candidate;
				bestTime = meta.registrationTime;
			}
		}

		return bestCandidate;
	}

	private findParentInDOM(element: HTMLElement, parentId: Focusable): HTMLElement | null {
		let current = element.parentElement;
		
		while (current) {
			const metadata = this.elementRegistry.get(current);
			if (metadata && metadata.logicalId === parentId) {
				return current;
			}
			current = current.parentElement;
		}
		
		return null;
	}

	private resolvePendingRelationships(newLogicalId: Focusable, newElement: HTMLElement) {
		// Find pending relationships that can now be resolved
		const resolved: number[] = [];

		for (let i = 0; i < this.pendingRelationships.length; i++) {
			const pending = this.pendingRelationships[i]!;
			
			if (pending.parentId === newLogicalId) {
				// This newly registered element might be the parent
				const childMeta = this.elementRegistry.get(pending.childElement);
				if (childMeta && this.isValidParentChild(newElement, pending.childElement)) {
					// Link them up
					childMeta.parentElement = newElement;
					const parentMeta = this.elementRegistry.get(newElement);
					if (parentMeta) {
						this.addChild(parentMeta, pending.childElement);
					}
					resolved.push(i);
				}
			}
		}

		// Remove resolved relationships (in reverse order to avoid index shifts)
		for (let i = resolved.length - 1; i >= 0; i--) {
			this.pendingRelationships.splice(resolved[i]!, 1);
		}
	}

	private isValidParentChild(parentElement: HTMLElement, childElement: HTMLElement): boolean {
		// Verify DOM hierarchy: child should be descendant of parent
		return parentElement.contains(childElement);
	}

	unregister(logicalId: Focusable, element?: HTMLElement) {
		if (element) {
			// Unregister specific element
			this.unregisterElement(element);
		} else {
			// Unregister all elements with this logicalId
			const elements = this.logicalIndex.get(logicalId);
			if (elements) {
				for (const elem of Array.from(elements)) {
					this.unregisterElement(elem);
				}
			}
		}

		// Remove pending relationships
		this.pendingRelationships = this.pendingRelationships.filter(
			p => p.parentId !== logicalId && 
			(!element || p.childElement !== element)
		);

		// Clear current if it matches
		if (this._currentElement) {
			const currentMeta = this.elementRegistry.get(this._currentElement);
			if (!currentMeta || (element && this._currentElement === element) || 
				(!element && currentMeta.logicalId === logicalId)) {
				this._currentElement = undefined;
			}
		}
	}

	setActive(elementOrId: HTMLElement | Focusable) {
		let targetElement: HTMLElement | undefined;

		if (elementOrId instanceof HTMLElement) {
			targetElement = elementOrId;
		} else {
			// Find element with this logicalId - prefer most recent or first in DOM order
			const candidates = this.logicalIndex.get(elementOrId);
			if (candidates && candidates.length > 0) {
				targetElement = this.selectBestCandidate(candidates);
			}
		}

		if (targetElement && this.elementRegistry.has(targetElement)) {
			const previousElement = this._currentElement;
			const previousMeta = previousElement ? this.elementRegistry.get(previousElement) : null;
			const newMeta = this.elementRegistry.get(targetElement)!;

			// Call onBlur for previous element
			if (previousElement && previousMeta?.options.onBlur) {
				previousMeta.options.onBlur(this.createContext(previousElement, previousMeta));
			}

			this._currentElement = targetElement;

			// Call onFocus for new element
			if (newMeta.options.onFocus) {
				newMeta.options.onFocus(this.createContext(targetElement, newMeta));
			}
		}
	}

	private selectBestCandidate(candidates: HTMLElement[]): HTMLElement {
		// Strategy: prefer enabled, visible, high-priority elements
		let bestCandidate = candidates[0]!;
		let bestScore = this.scoreElement(bestCandidate);

		for (const candidate of candidates) {
			const score = this.scoreElement(candidate);
			if (score > bestScore) {
				bestCandidate = candidate;
				bestScore = score;
			}
		}

		return bestCandidate;
	}

	private scoreElement(element: HTMLElement): number {
		const meta = this.elementRegistry.get(element);
		if (!meta) return 0;

		// Disabled elements get very low score
		if (meta.options.disabled) return -1000;

		let score = 0;
		
		// Priority boost (default 0)
		score += (meta.options.priority || 0) * 1000;
		
		// Prefer visible elements
		const rect = element.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) score += 100;
		
		// Prefer more recently registered
		score += meta.registrationTime / 1000000; // Scale down timestamp
		
		return score;
	}

	// Lazy resolution: ensure parent-child relationships are correct before navigation
	private ensureRelationships(element: HTMLElement) {
		const metadata = this.elementRegistry.get(element);
		if (!metadata) return;

		// If no parent but there are pending relationships, try to resolve
		if (!metadata.parentElement && this.pendingRelationships.length > 0) {
			this.tryResolveOrphan(element);
		}
	}

	private tryResolveOrphan(element: HTMLElement) {
		const metadata = this.elementRegistry.get(element);
		if (!metadata) return;

		// Look for a registered ancestor in the DOM
		let current = element.parentElement;
		while (current) {
			if (this.elementRegistry.has(current)) {
				// Found a registered ancestor - link them
				metadata.parentElement = current;
				const parentMeta = this.elementRegistry.get(current);
				if (parentMeta) {
					this.addChild(parentMeta, element);
				}
				break;
			}
			current = current.parentElement;
		}
	}

	private sortSiblingsByTabOrder(siblings: HTMLElement[]): HTMLElement[] {
		return siblings
			.filter(sibling => {
				const meta = this.elementRegistry.get(sibling);
				return meta && !meta.options.disabled;
			})
			.sort((a, b) => {
				const metaA = this.elementRegistry.get(a)!;
				const metaB = this.elementRegistry.get(b)!;
				
				const tabA = metaA.options.tabIndex ?? 0;
				const tabB = metaB.options.tabIndex ?? 0;
				
				// First sort by tabIndex
				if (tabA !== tabB) return tabA - tabB;
				
				// Then by registration order (already in array order)
				return siblings.indexOf(a) - siblings.indexOf(b);
			});
	}

	focusSibling(forward = true) {
		if (!this._currentElement) return;
		
		this.ensureRelationships(this._currentElement);
		const metadata = this.elementRegistry.get(this._currentElement);
		if (!metadata?.parentElement) return;

		const parentMeta = this.elementRegistry.get(metadata.parentElement);
		if (!parentMeta) return;

		const siblings = this.sortSiblingsByTabOrder(parentMeta.children);
		if (siblings.length === 0) return;

		const currentIndex = siblings.indexOf(this._currentElement);
		if (currentIndex === -1) return;

		const nextIndex = forward 
			? (currentIndex + 1) % siblings.length
			: (currentIndex - 1 + siblings.length) % siblings.length;

		const nextSibling = siblings[nextIndex];
		if (nextSibling) {
			this.setActive(nextSibling);
			nextSibling.focus();
		}
	}

	focusParent() {
		if (!this._currentElement) return;
		
		this.ensureRelationships(this._currentElement);
		const metadata = this.elementRegistry.get(this._currentElement);
		if (!metadata?.parentElement) return;

		this.setActive(metadata.parentElement);
		metadata.parentElement.focus();
	}

	focusFirstChild() {
		if (!this._currentElement) return;
		
		this.ensureRelationships(this._currentElement);
		const metadata = this.elementRegistry.get(this._currentElement);
		if (!metadata || metadata.children.length === 0) return;

		const firstChild = metadata.children[0]; // First in registration order
		if (firstChild) {
			this.setActive(firstChild);
			firstChild.focus();
		}
	}

	handleKeydown(event: KeyboardEvent) {
		// Try custom handler first if current element has one
		if (this._currentElement) {
			const metadata = this.elementRegistry.get(this._currentElement);
			if (metadata?.options.onKeydown) {
				const context = this.createContext(this._currentElement, metadata);
				const handled = metadata.options.onKeydown(event, context);
				if (handled !== false) { // If handler returns false, continue with default behavior
					return;
				}
			}
		}

		// Default keyboard handling
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

	radioGroup(args: { triggers: Focusable[] }): Reactive<Focusable | undefined> {
		if (args.triggers.length < 2) {
			throw new Error('Radio group requires two or more triggers.');
		}

		let current = $state<Focusable | undefined>(args.triggers[0]);
		
		$effect(() => {
			if (!this._currentElement) return;
			
			// Walk up the hierarchy to find a matching trigger
			let searchElement: HTMLElement | null = this._currentElement;
			
			while (searchElement) {
				const metadata = this.elementRegistry.get(searchElement);
				if (metadata && args.triggers.includes(metadata.logicalId)) {
					current = metadata.logicalId;
					break;
				}
				searchElement = metadata?.parentElement || null;
			}
		});

		return reactive(() => current);
	}

	// Utility methods for working with extended data
	findElementsByTag(tag: string): HTMLElement[] {
		const result: HTMLElement[] = [];
		for (const [element, metadata] of this.elementRegistry) {
			if (metadata.options.tags?.includes(tag)) {
				result.push(element);
			}
		}
		return result;
	}

	findElementsByDisplayName(name: string): HTMLElement[] {
		const result: HTMLElement[] = [];
		for (const [element, metadata] of this.elementRegistry) {
			if (metadata.options.displayName === name) {
				result.push(element);
			}
		}
		return result;
	}

	getElementOptions<TPayload = any>(elementOrId: HTMLElement | Focusable): FocusableOptions<TPayload> | null {
		let element: HTMLElement | undefined;
		
		if (elementOrId instanceof HTMLElement) {
			element = elementOrId;
		} else {
			const candidates = this.logicalIndex.get(elementOrId);
			if (candidates && candidates.length > 0) {
				element = this.selectBestCandidate(candidates);
			}
		}
		
		if (element) {
			const metadata = this.elementRegistry.get(element);
			return metadata?.options || null;
		}
		
		return null;
	}

	updateElementOptions<TPayload = any>(elementOrId: HTMLElement | Focusable, updates: Partial<FocusableOptions<TPayload>>): boolean {
		let element: HTMLElement | undefined;
		
		if (elementOrId instanceof HTMLElement) {
			element = elementOrId;
		} else {
			const candidates = this.logicalIndex.get(elementOrId);
			if (candidates && candidates.length > 0) {
				element = this.selectBestCandidate(candidates);
			}
		}
		
		if (element) {
			const metadata = this.elementRegistry.get(element);
			if (metadata) {
				// Merge updates into existing options
				metadata.options = { ...metadata.options, ...updates };
				return true;
			}
		}
		
		return false;
	}

	// Debug utilities
	getRegistrationStats() {
		return {
			registered: this.elementRegistry.size,
			pending: this.pendingRelationships.length,
			logicalIds: this.logicalIndex.size,
			disabled: Array.from(this.elementRegistry.values()).filter(m => m.options.disabled).length,
			withCustomHandlers: Array.from(this.elementRegistry.values()).filter(m => 
				m.options.onKeydown || m.options.onFocus || m.options.onBlur
			).length
		};
	}

	getPendingRelationships() {
		return this.pendingRelationships.map(p => ({
			childLogicalId: this.elementRegistry.get(p.childElement)?.logicalId,
			parentId: p.parentId,
			age: Date.now() - p.registrationTime
		}));
	}

	getElementTree(): Record<string, any> {
		const result: Record<string, any> = {};
		
		for (const [element, metadata] of this.elementRegistry) {
			const key = `${metadata.logicalId} (${metadata.options.displayName || 'unnamed'})`;
			result[key] = {
				disabled: metadata.options.disabled,
				priority: metadata.options.priority,
				tabIndex: metadata.options.tabIndex,
				tags: metadata.options.tags,
				hasHandlers: {
					onKeydown: !!metadata.options.onKeydown,
					onFocus: !!metadata.options.onFocus,
					onBlur: !!metadata.options.onBlur
				},
				children: metadata.children.map(child => {
					const childMeta = this.elementRegistry.get(child);
					return childMeta ? 
						`${childMeta.logicalId} (${childMeta.options.displayName || 'unnamed'})` : 
						'unknown';
				})
			};
		}
		
		return result;
	}
}

/*
USAGE EXAMPLES:

// Simple registration (backwards compatible)
focusManager.register('workspace', null, workspaceElement);

// Rich registration with typed payload
focusManager.register({
	id: 'stack',
	parentId: 'workspace',
	payload: { stackId: 'abc123', branchName: 'feature/new-ui' },
	onKeydown: (event, context) => {
		if (event.key === 'Delete') {
			deleteStack(context.payload.stackId);
			return true;
		}
	}
}, stackElement);

// Using factory functions for common patterns
const stackOptions = createStackOptions('workspace', {
	stackId: 'abc123',
	branchName: 'feature/new-ui',
	isActive: true
}, {
	priority: 10,
	onFocus: (context) => {
		highlightStack(context.payload.stackId);
		updatePreview(context.payload.branchName);
	}
});

focusManager.register(stackOptions, stackElement);

// Multiple items with typed payloads
items.forEach((item, index) => {
	const itemOptions = createItemOptions('stack', {
		itemId: item.id,
		index,
		data: item
	}, {
		onKeydown: (event, context) => {
			if (event.key === 'Enter') {
				selectItem(context.payload.data);
				return true;
			}
		}
	});
	
	focusManager.register(itemOptions, item.element);
});
*/