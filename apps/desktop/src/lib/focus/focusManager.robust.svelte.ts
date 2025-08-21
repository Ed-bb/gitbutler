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

interface ElementMetadata {
	logicalId: Focusable;
	parentElement: HTMLElement | null;
	children: HTMLElement[]; // Preserve registration order
	// Track registration state
	registrationTime: number;
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
	private elementRegistry = new Map<HTMLElement, ElementMetadata>();
	
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

	register(logicalId: Focusable, parentId: Focusable | null, element: HTMLElement) {
		const registrationTime = Date.now();

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
			registrationTime
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
			this._currentElement = targetElement;
		}
	}

	private selectBestCandidate(candidates: HTMLElement[]): HTMLElement {
		// Strategy: prefer visible elements, then most recently registered
		// Since arrays preserve order, the last element is the most recently registered
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

		let score = 0;
		
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

	focusSibling(forward = true) {
		if (!this._currentElement) return;
		
		this.ensureRelationships(this._currentElement);
		const metadata = this.elementRegistry.get(this._currentElement);
		if (!metadata?.parentElement) return;

		const parentMeta = this.elementRegistry.get(metadata.parentElement);
		if (!parentMeta) return;

		const siblings = parentMeta.children; // Already an array, preserves order
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

	// Debug utilities
	getRegistrationStats() {
		return {
			registered: this.elementRegistry.size,
			pending: this.pendingRelationships.length,
			logicalIds: this.logicalIndex.size
		};
	}

	getPendingRelationships() {
		return this.pendingRelationships.map(p => ({
			childLogicalId: this.elementRegistry.get(p.childElement)?.logicalId,
			parentId: p.parentId,
			age: Date.now() - p.registrationTime
		}));
	}
}