import { type Focusable, FOCUS_MANAGER, type FocusableOptions } from '$lib/focus/focusManager.robust.svelte';
import { inject } from '@gitbutler/shared/context';
import type { Action } from 'svelte/action';

// Legacy interface for backwards compatibility
interface LegacyFocusableOptions {
	id: Focusable;
	parentId?: Focusable | null;
}

// Union type to support both legacy and new APIs
type FocusableActionOptions<TPayload = any> = 
	| LegacyFocusableOptions 
	| FocusableOptions<TPayload>;

/**
 * Enhanced Svelte action that registers an element as a focusable area.
 * 
 * Supports both legacy API for backwards compatibility and new rich API
 * with payloads, event handlers, and advanced configuration.
 * 
 * @example
 * // Legacy usage (backwards compatible)
 * <div use:focusable={{ id: 'stack', parentId: 'workspace' }}>
 * 
 * @example  
 * // New rich usage with payload
 * <div use:focusable={{
 *   id: 'stack',
 *   parentId: 'workspace', 
 *   payload: { stackId: 'abc123', branchName: 'feature' },
 *   onKeydown: (event, context) => handleStackKeys(event, context.payload),
 *   onFocus: (context) => highlightStack(context.payload.stackId)
 * }}>
 */
export function focusable<TPayload = any>(
	element: HTMLElement,
	options: FocusableActionOptions<TPayload>
): ReturnType<Action<HTMLElement, FocusableActionOptions<TPayload>>> {
	const focus = inject(FOCUS_MANAGER);
	
	let currentOptions = options;
	let isRegistered = false;

	function register() {
		if (isRegistered) return;
		
		// Convert legacy format to new format if needed
		const normalizedOptions = isLegacyOptions(currentOptions) 
			? convertLegacyOptions(currentOptions)
			: currentOptions;

		focus.register(normalizedOptions, element);
		isRegistered = true;
	}

	function unregister() {
		if (!isRegistered) return;
		
		const id = getIdFromOptions(currentOptions);
		focus.unregister(id, element);
		isRegistered = false;
	}

	// Initial registration
	register();

	return {
		destroy() {
			unregister();
		},
		
		update(newOptions: FocusableActionOptions<TPayload>) {
			// If the ID changed, we need to unregister and re-register
			const oldId = getIdFromOptions(currentOptions);
			const newId = getIdFromOptions(newOptions);
			
			if (oldId !== newId) {
				unregister();
				currentOptions = newOptions;
				register();
			} else {
				// Same ID - we can update in place
				currentOptions = newOptions;
				const normalizedOptions = isLegacyOptions(newOptions)
					? convertLegacyOptions(newOptions)
					: newOptions;
				
				// Update the existing registration
				focus.updateElementOptions(element, normalizedOptions);
			}
		}
	};
}

// Type guard to check if using legacy API
function isLegacyOptions<TPayload>(
	options: FocusableActionOptions<TPayload>
): options is LegacyFocusableOptions {
	// Legacy options only have 'id' and optionally 'parentId'
	const keys = Object.keys(options);
	return keys.length <= 2 && 
		   keys.includes('id') && 
		   !keys.some(key => !['id', 'parentId'].includes(key));
}

// Convert legacy options to new format
function convertLegacyOptions(legacy: LegacyFocusableOptions): FocusableOptions {
	return {
		id: legacy.id,
		parentId: legacy.parentId || null
	};
}

// Extract ID from either format
function getIdFromOptions<TPayload>(options: FocusableActionOptions<TPayload>): Focusable {
	return options.id;
}

// Export a typed version for specific payload types
export function typedFocusable<TPayload>() {
	return (element: HTMLElement, options: FocusableOptions<TPayload>) => 
		focusable<TPayload>(element, options);
}

/*
MIGRATION EXAMPLES:

// Current usage (works unchanged)
<div use:focusable={{ id: DefinedFocusable.Stack + ':' + stackId, parentId: DefinedFocusable.ViewportMiddle }}>

// Migrated to new API with payload
<div use:focusable={{
	id: 'stack',
	parentId: DefinedFocusable.ViewportMiddle,
	payload: { stackId, branchName: stack.branchName },
	displayName: `Stack: ${stackId}`,
	onKeydown: (event, context) => {
		if (event.key === 'Delete') {
			deleteStack(context.payload.stackId);
			return true;
		}
	}
}}>

// Using factory functions for common patterns
<script>
	import { createStackOptions } from '$lib/focus/focusManager.robust.svelte';
	
	$: stackFocusOptions = createStackOptions(DefinedFocusable.ViewportMiddle, {
		stackId,
		branchName: stack.branchName,
		isActive: stack.isActive
	}, {
		onKeydown: handleStackKeyboard,
		onFocus: () => setActiveStack(stackId)
	});
</script>

<div use:focusable={stackFocusOptions}>

// Type-safe version with specific payload type
<script>
	interface StackPayload {
		stackId: string;
		branchName: string;
		isActive: boolean;
	}
	
	const stackFocusable = typedFocusable<StackPayload>();
</script>

<div use:stackFocusable={{
	id: 'stack',
	parentId: DefinedFocusable.ViewportMiddle,
	payload: { stackId, branchName, isActive },
	onKeydown: (event, context) => {
		// context.payload is fully typed as StackPayload
		handleStack(context.payload.stackId, context.payload.isActive);
	}
}}>
*/