<!--
MIGRATION EXAMPLES: How to upgrade from current focusable to enhanced version

This file shows side-by-side comparisons of current vs enhanced usage
-->

<script lang="ts">
	import { DefinedFocusable } from '$lib/focus/focusManager.svelte';
	import { focusable } from '$lib/focus/focusable.enhanced.svelte';
	import { createStackOptions, type StackPayload } from '$lib/focus/focusManager.robust.svelte';
	
	// Example data
	let stackId = 'abc123';
	let branchName = 'feature/new-ui';
	let isActive = true;
	let commits = [];
	
	// Type-safe payload definition
	interface MyStackPayload extends StackPayload {
		commits: any[];
		customData: { priority: number };
	}
	
	function handleStackKeyboard(event: KeyboardEvent, context: any) {
		const { stackId, branchName } = context.payload;
		
		switch (event.key) {
			case 'Delete':
				deleteStack(stackId);
				return true;
			case 'Enter': 
				openStackDetails(stackId);
				return true;
			case 'r':
				if (event.metaKey) {
					rebaseStack(stackId);
					return true;
				}
				break;
		}
		return false; // Let default navigation handle Tab, arrows, etc.
	}
	
	function handleStackFocus(context: any) {
		highlightStack(context.payload.stackId);
		updatePreview(context.payload.branchName);
		showStackInfo(context.payload.commits.length);
	}
	
	function deleteStack(id: string) { /* ... */ }
	function openStackDetails(id: string) { /* ... */ }
	function rebaseStack(id: string) { /* ... */ }
	function highlightStack(id: string) { /* ... */ }
	function updatePreview(branch: string) { /* ... */ }
	function showStackInfo(commitCount: number) { /* ... */ }
</script>

<!-- 
====================================================================
EXAMPLE 1: Basic Stack Component Migration
==================================================================== 
-->

<!-- BEFORE: Current implementation -->
<div 
	class="stack-old"
	use:focusable={{
		id: DefinedFocusable.Stack + ':' + stackId,
		parentId: DefinedFocusable.ViewportMiddle
	}}
>
	<!-- Stack content with old string-based ID -->
	<p>Stack: {stackId}</p>
</div>

<!-- AFTER: Enhanced implementation with payload -->
<div 
	class="stack-new"
	use:focusable={{
		id: 'stack',
		parentId: DefinedFocusable.ViewportMiddle,
		payload: { 
			stackId, 
			branchName,
			isActive 
		},
		displayName: `Stack: ${stackId}`,
		tags: ['stack', isActive ? 'active' : 'inactive'],
		priority: isActive ? 10 : 5,
		onKeydown: handleStackKeyboard,
		onFocus: handleStackFocus,
		onBlur: () => console.log('Stack lost focus')
	}}
>
	<!-- Same content, much richer functionality -->
	<p>Stack: {stackId} ({branchName})</p>
</div>

<!-- 
====================================================================
EXAMPLE 2: Using Factory Functions
==================================================================== 
-->

<!-- Computed options using factory function -->
{@const stackOptions = createStackOptions(DefinedFocusable.ViewportMiddle, {
	stackId,
	branchName, 
	isActive
}, {
	priority: isActive ? 10 : 1,
	disabled: !isActive,
	onKeydown: handleStackKeyboard,
	onFocus: handleStackFocus
})}

<div 
	class="stack-factory"
	use:focusable={stackOptions}
>
	<p>Stack created with factory: {stackId}</p>
</div>

<!-- 
====================================================================
EXAMPLE 3: Multiple Items with Same Logical ID
==================================================================== 
-->

{#each [1, 2, 3, 4] as item, index}
	<!-- BEFORE: Had to create unique IDs -->
	<div use:focusable={{
		id: 'item:' + item,
		parentId: 'stack:' + stackId
	}}>
		Item {item} (old way)
	</div>
	
	<!-- AFTER: Same logical ID, different payloads -->
	<div use:focusable={{
		id: 'item',
		parentId: 'stack',
		payload: { 
			itemId: item,
			index,
			data: { name: `Item ${item}`, priority: item * 10 }
		},
		tabIndex: index, // Controls tab order
		displayName: `Item ${item}`,
		onKeydown: (event, context) => {
			if (event.key === 'Enter') {
				selectItem(context.payload.data);
				return true;
			}
		}
	}}>
		Item {item} (enhanced with payload)
	</div>
{/each}

<!-- 
====================================================================
EXAMPLE 4: Conditional and Dynamic Registration 
==================================================================== 
-->

{#if isActive}
	<div use:focusable={{
		id: 'active-indicator',
		parentId: 'stack',
		payload: { stackId, lastActive: Date.now() },
		priority: 100, // High priority when active
		tags: ['indicator', 'active'],
		onFocus: (context) => {
			console.log(`Stack ${context.payload.stackId} was last active:`, 
				new Date(context.payload.lastActive));
		}
	}}>
		🟢 Active Stack
	</div>
{/if}

<!-- 
====================================================================
EXAMPLE 5: Rich Keyboard Handling
==================================================================== 
-->

<div use:focusable={{
	id: 'stack-with-rich-keys',
	parentId: DefinedFocusable.ViewportMiddle,
	payload: { 
		stackId, 
		branchName,
		commits,
		customData: { priority: 5 } 
	} satisfies MyStackPayload,
	onKeydown: (event, context) => {
		// Full access to typed payload
		const { stackId, branchName, commits, customData } = context.payload;
		
		if (event.metaKey) {
			switch (event.key) {
				case 'd': deleteStack(stackId); return true;
				case 'r': rebaseStack(stackId); return true;
				case 'o': openStackDetails(stackId); return true;
			}
		}
		
		if (event.key === 'ArrowRight' && commits.length > 0) {
			// Navigate to first commit
			context.manager.setActive('commit');
			return true;
		}
		
		return false; // Continue with default navigation
	}
}}>
	<div class="stack-header">
		<h3>{branchName}</h3>
		<span class="commit-count">{commits.length} commits</span>
	</div>
</div>

<style>
	.stack-old, .stack-new, .stack-factory {
		padding: 1rem;
		margin: 0.5rem;
		border: 2px solid #ccc;
		border-radius: 4px;
	}
	
	.stack-new:focus-within {
		border-color: #007acc;
		background-color: #f0f8ff;
	}
	
	.stack-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	
	.commit-count {
		background: #007acc;
		color: white;
		padding: 0.25rem 0.5rem;
		border-radius: 12px;
		font-size: 0.8rem;
	}
</style>

<!--
====================================================================
MIGRATION BENEFITS SUMMARY:
====================================================================

✅ BACKWARDS COMPATIBLE
   - Existing use:focusable calls work unchanged
   - Can migrate incrementally

✅ CLEANER IDS  
   - No more string concatenation: 'stack' instead of 'stack:abc123'
   - Multiple elements can share same logical ID

✅ TYPE SAFETY
   - Payload types ensure compile-time safety
   - Full IntelliSense support in handlers

✅ RICH FUNCTIONALITY
   - Custom keyboard handlers per element
   - Focus/blur callbacks
   - Priority system, disabled state, custom tab order
   - Searchable tags and display names

✅ BETTER DEBUGGING
   - Clear payload inspection
   - Rich metadata in dev tools
   - Element tree visualization

✅ PERFORMANCE
   - O(1) lookups instead of linear search
   - Efficient sibling navigation
   - Smart candidate selection

MIGRATION PATH:
1. Replace imports: focusable.svelte → focusable.enhanced.svelte
2. Start using simple payloads for data instead of ID encoding  
3. Add keyboard handlers and focus callbacks as needed
4. Use factory functions for common patterns
5. Leverage type safety with TypeScript interfaces
-->