<!--
EXAMPLE: StackView.svelte refactored to use enhanced focusable system

This shows how the current StackView component could be upgraded to use
the new payload-based system instead of string concatenation IDs.
-->

<script lang="ts">
	// ... existing imports ...
	import { DefinedFocusable } from '$lib/focus/focusManager.svelte';
	import { focusable } from '$lib/focus/focusable.enhanced.svelte'; // Enhanced version
	import { createStackOptions, type StackPayload } from '$lib/focus/focusManager.robust.svelte';
	
	// ... existing props and state ...
	type Props = {
		projectId: string;
		stackId?: string;
		laneId: string;
		topBranch?: string;
		focusedStackId?: string;
		onVisible: (visible: boolean) => void;
		clientWidth?: number;
	};
	
	let { 
		projectId, 
		stackId, 
		laneId, 
		topBranch, 
		focusedStackId, 
		onVisible,
		clientWidth 
	}: Props = $props();
	
	// ... existing reactive statements ...
	
	// Define our stack payload type
	interface MyStackPayload extends StackPayload {
		projectId: string;
		laneId: string; 
		topBranch?: string;
		commits: any[];
		isActive: boolean;
	}
	
	// Stack keyboard handler
	function handleStackKeyboard(event: KeyboardEvent, context: { payload: MyStackPayload }) {
		const { stackId, projectId, laneId, isActive, commits } = context.payload;
		
		if (!isActive) return false; // Only handle keys for active stacks
		
		switch (event.key) {
			case 'Delete':
				if (event.metaKey) {
					deleteStack(stackId);
					return true; // Handled
				}
				break;
				
			case 'Enter':
				expandStack(stackId);
				return true;
				
			case 'r':
				if (event.metaKey) {
					rebaseStack(stackId);
					return true;
				}
				break;
				
			case 'ArrowRight':
				if (commits.length > 0) {
					// Navigate to first commit in the stack
					context.manager.setActive('commit');
					return true;
				}
				break;
				
			case 'ArrowDown':
				// Navigate to uncommitted changes
				context.manager.setActive('uncommitted-changes');
				return true;
		}
		
		return false; // Let default navigation handle Tab, etc.
	}
	
	// Stack focus handler
	function handleStackFocus(context: { payload: MyStackPayload }) {
		const { stackId, isActive } = context.payload;
		
		// Update UI state
		if (isActive) {
			highlightStack(stackId);
			updatePreview(stackId);
		}
		
		// Analytics or logging
		trackStackFocus(stackId);
	}
	
	function handleStackBlur(context: { payload: MyStackPayload }) {
		const { stackId } = context.payload;
		unhighlightStack(stackId);
	}
	
	// Create computed stack options
	$: stackFocusOptions = createStackOptions(DefinedFocusable.ViewportMiddle, {
		stackId: stackId || '',
		branchName: topBranch || '',
		isActive: focusedStackId === stackId,
		projectId,
		laneId,
		topBranch,
		commits: [], // Would be populated from actual data
		isActive: focusedStackId === stackId
	} satisfies MyStackPayload, {
		priority: focusedStackId === stackId ? 10 : 5,
		disabled: !stackId, // Disable if no stackId
		displayName: `Stack: ${stackId} (${topBranch || 'no branch'})`,
		tags: [
			'stack', 
			focusedStackId === stackId ? 'active' : 'inactive',
			topBranch ? 'has-branch' : 'no-branch'
		],
		onKeydown: handleStackKeyboard,
		onFocus: handleStackFocus,
		onBlur: handleStackBlur
	});
	
	// Helper functions (these would be implemented elsewhere)
	function deleteStack(stackId: string) { console.log('Delete stack:', stackId); }
	function expandStack(stackId: string) { console.log('Expand stack:', stackId); }
	function rebaseStack(stackId: string) { console.log('Rebase stack:', stackId); }
	function highlightStack(stackId: string) { console.log('Highlight stack:', stackId); }
	function unhighlightStack(stackId: string) { console.log('Unhighlight stack:', stackId); }
	function updatePreview(stackId: string) { console.log('Update preview:', stackId); }
	function trackStackFocus(stackId: string) { console.log('Track focus:', stackId); }
</script>

<!-- BEFORE: String concatenation for unique IDs -->
<!--
<ConfigurableScrollableContainer
	bind:element={lanesSrollableEl}
	direction="column"
	scrollbarPadding={{
		right: lanesSrollableEl
		}}
	use:focusable={{
		id: DefinedFocusable.Stack + ':' + stackId,  // ← String concatenation
		parentId: DefinedFocusable.ViewportMiddle
	}}
	on:visible={onVisible}
>
-->

<!-- AFTER: Rich payload-based registration -->
<ConfigurableScrollableContainer
	bind:element={lanesSrollableEl}
	direction="column"
	scrollbarPadding={{
		root: lanesSrollableEl
	}}
	use:focusable={stackFocusOptions}  <!-- ← Rich options with payload -->
	on:visible={onVisible}
>
	<!-- Stack content with enhanced keyboard navigation -->
	
	{#if stackId}
		<div class="stack-header">
			<h3>Stack: {stackId}</h3>
			{#if topBranch}
				<span class="branch-name">{topBranch}</span>
			{/if}
			<div class="stack-actions">
				<span class="help-text">
					↵ Expand • ⌘R Rebase • ⌘⌫ Delete • → First Commit
				</span>
			</div>
		</div>
	{/if}
	
	<!-- Other stack content... -->
	<!-- Each child could also use enhanced focusable -->
	
	<!-- Example: Uncommitted changes with its own payload -->
	<div 
		class="uncommitted-section"
		use:focusable={{
			id: 'uncommitted-changes',
			parentId: 'stack',
			payload: {
				stackId: stackId || '',
				hasChanges: true,
				changeCount: 0 // Would come from actual data
			},
			displayName: 'Uncommitted Changes',
			tags: ['uncommitted', 'changes'],
			onKeydown: (event, context) => {
				if (event.key === 'Enter') {
					openUncommittedChanges(context.payload.stackId);
					return true;
				}
				return false;
			}
		}}
	>
		<!-- Uncommitted changes content -->
	</div>
	
	<!-- Example: Individual commits with payloads -->
	{#each mockCommits as commit, index}
		<div 
			class="commit-item"
			use:focusable={{
				id: 'commit',
				parentId: 'stack',
				payload: {
					commitId: commit.id,
					stackId: stackId || '',
					index,
					message: commit.message,
					author: commit.author
				},
				displayName: `Commit: ${commit.message.substring(0, 50)}...`,
				tabIndex: index,
				tags: ['commit'],
				onKeydown: (event, context) => {
					if (event.key === 'Enter') {
						openCommitDetails(context.payload.commitId);
						return true;
					} else if (event.key === 'Delete' && event.metaKey) {
						deleteCommit(context.payload.commitId);
						return true;
					}
					return false;
				},
				onFocus: (context) => {
					showCommitPreview(context.payload);
				}
			}}
		>
			<div class="commit-info">
				<div class="commit-message">{commit.message}</div>
				<div class="commit-meta">{commit.author} • {commit.timestamp}</div>
			</div>
		</div>
	{/each}
</ConfigurableScrollableContainer>

<style>
	.stack-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
		background: #f8f9fa;
		border-bottom: 1px solid #dee2e6;
	}
	
	.branch-name {
		background: #007acc;
		color: white;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-size: 0.8rem;
	}
	
	.stack-actions {
		margin-left: auto;
	}
	
	.help-text {
		font-size: 0.75rem;
		color: #6c757d;
		font-family: monospace;
	}
	
	.uncommitted-section, .commit-item {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #e9ecef;
		cursor: pointer;
	}
	
	.uncommitted-section:focus, .commit-item:focus {
		background: #e3f2fd;
		outline: 2px solid #1976d2;
		outline-offset: -2px;
	}
	
	.commit-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	
	.commit-message {
		font-weight: 500;
	}
	
	.commit-meta {
		font-size: 0.8rem;
		color: #6c757d;
	}
</style>

<script>
	// Mock data for example
	const mockCommits = [
		{ id: '1', message: 'Add user authentication', author: 'Alice', timestamp: '2 hours ago' },
		{ id: '2', message: 'Fix navigation bug', author: 'Bob', timestamp: '1 day ago' },
		{ id: '3', message: 'Update dependencies', author: 'Charlie', timestamp: '3 days ago' }
	];
	
	function openUncommittedChanges(stackId: string) { console.log('Open uncommitted for:', stackId); }
	function openCommitDetails(commitId: string) { console.log('Open commit:', commitId); }
	function deleteCommit(commitId: string) { console.log('Delete commit:', commitId); }
	function showCommitPreview(payload: any) { console.log('Preview commit:', payload); }
</script>

<!--
KEY IMPROVEMENTS IN THIS REFACTOR:

✅ NO MORE STRING CONCATENATION
   - Clean logical IDs: 'stack', 'commit', 'uncommitted-changes'
   - Data lives in type-safe payloads

✅ RICH KEYBOARD NAVIGATION  
   - Per-element keyboard handlers
   - Context-aware actions (Delete stack vs Delete commit)
   - Custom navigation flows (→ to first commit)

✅ BETTER FOCUS MANAGEMENT
   - Priority system (active stacks get higher priority)
   - Disabled state support
   - Smart candidate selection

✅ ENHANCED DEBUGGING
   - Descriptive display names
   - Searchable tags
   - Rich metadata for inspection

✅ TYPE SAFETY
   - Strongly typed payloads
   - IntelliSense in event handlers  
   - Compile-time error checking

✅ MAINTAINABILITY
   - Separated concerns (keyboard logic, focus logic, etc.)
   - Reusable patterns with factory functions
   - Self-documenting code with good payload names

MIGRATION WOULD BE:
1. Import enhanced focusable
2. Define payload interfaces  
3. Replace string concatenation with payload data
4. Add keyboard handlers as needed
5. Leverage new features (priority, tags, etc.)
-->