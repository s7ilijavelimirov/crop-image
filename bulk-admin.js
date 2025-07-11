jQuery(document).ready(function ($) {
    let selectedImages = [];
    let selectedProducts = [];
    let currentCategory = '';
    let currentPage = 1;
    let totalPages = 1;
    let perPage = 50;
    let isProcessing = false;
    let currentSearchTerm = '';

    init();

    function init() {
        loadCategories();
        setupEventHandlers();
        setupHeartbeat();
    }

    function setupHeartbeat() {
        wp.heartbeat.enqueue('bulk_cropper_heartbeat', true, true);

        $(document).on('heartbeat-send', function (e, data) {
            if (isProcessing) {
                data.bulk_cropper_heartbeat = true;
            }
        });

        $(document).on('heartbeat-tick', function (e, data) {
            if (data.bulk_cropper_heartbeat && data.bulk_cropper_heartbeat === 'alive') {
                console.log('Heartbeat alive');
            }
        });
    }

    function setupEventHandlers() {
        // Category selection
        $('#category-select').on('change', function () {
            currentCategory = $(this).val();
            $('#load-category-products').prop('disabled', !currentCategory);
            updateCategoryInfo();
        });

        $('#load-category-products').on('click', function () {
            currentPage = 1;
            loadCategoryProducts();
        });

        $('#reset-plugin').on('click', function () {
            if (confirm('Reset all data and start fresh?')) {
                resetPluginState();
            }
        });

        // Pagination
        $('#prev-page').on('click', function () {
            if (currentPage > 1 && !isProcessing) {
                currentPage--;
                loadCategoryProducts();
            }
        });

        $('#next-page').on('click', function () {
            if (currentPage < totalPages && !isProcessing) {
                currentPage++;
                loadCategoryProducts();
            }
        });

        $('#per-page-select').on('change', function () {
            if (!isProcessing) {
                perPage = parseInt($(this).val());
                currentPage = 1;
                loadCategoryProducts();
            }
        });

        // Search functionality
        $('#search-products').on('input', function () {
            let searchTerm = $(this).val().trim();
            $('#clear-search').toggle(searchTerm.length > 0);

            if (searchTerm.length > 0) {
                $(this).closest('.category-controls').addClass('search-active');
            } else {
                $(this).closest('.category-controls').removeClass('search-active');
            }

            if (searchTerm.length >= 2 || searchTerm.length === 0) {
                currentSearchTerm = searchTerm;
                currentPage = 1;

                clearTimeout(window.searchTimeout);
                window.searchTimeout = setTimeout(function () {
                    if (!isProcessing) {
                        loadCategoryProducts();
                    }
                }, 500);
            }
        });

        $('#clear-search').on('click', function () {
            $('#search-products').val('').focus();
            $('.category-controls').removeClass('search-active');
            currentSearchTerm = '';
            currentPage = 1;
            if (!isProcessing) {
                loadCategoryProducts();
            }
            $(this).hide();
        });

        // Product selection
        $(document).on('change', '.product-checkbox', function () {
            let productId = parseInt($(this).val());
            let productCard = $(this).closest('.product-card');

            if ($(this).is(':checked')) {
                if (selectedProducts.indexOf(productId) === -1) {
                    selectedProducts.push(productId);
                    productCard.addClass('selected');
                }
            } else {
                selectedProducts = selectedProducts.filter(id => id !== productId);
                productCard.removeClass('selected');
            }
            updateSelectedProductsDisplay();
        });

        $('#load-all-selected-images').on('click', function () {
            if (selectedProducts.length === 0) {
                showNotification('Please select products first', 'error');
                return;
            }
            loadSelectedProductsImages();
        });

        $('#clear-selection').on('click', function () {
            clearAllSelections();
        });

        // Image selection
        $(document).on('change', '.image-checkbox', function () {
            let imageId = parseInt($(this).val());

            if ($(this).is(':checked')) {
                if (selectedImages.indexOf(imageId) === -1) {
                    selectedImages.push(imageId);
                }
            } else {
                selectedImages = selectedImages.filter(id => id !== imageId);
            }
            updateSelectedImagesDisplay();
        });

        $('#select-all-images').on('click', function () {
            $('.image-checkbox').prop('checked', true).trigger('change');
        });

        $('#deselect-all-images').on('click', function () {
            $('.image-checkbox').prop('checked', false).trigger('change');
        });

        // Individual padding update - updates only individual button text
        $(document).on('input', '.padding-input', function () {
            let imageId = $(this).closest('.image-item').data('image-id');
            let padding = parseInt($(this).val()) || 5;
            
            // Update individual crop button text
            let cropBtn = $('.image-item[data-image-id="' + imageId + '"] .crop-individual');
            cropBtn.text('Crop (' + padding + 'px)');
        });

        // Individual crop button
        $(document).on('click', '.crop-individual', function () {
            if (isProcessing) {
                showNotification('Please wait for current operation to complete', 'warning');
                return;
            }

            let imageId = $(this).data('image-id');
            let paddingInput = $(this).closest('.image-item').find('.padding-input');
            let padding = parseInt(paddingInput.val()) || 5;

            cropImageToResults(imageId, padding, $(this));
        });

        // Bulk crop with fixed 5px padding (recommended)
        $('#crop-selected').on('click', function () {
            if (isProcessing) {
                showNotification('Please wait for current operation to complete', 'warning');
                return;
            }

            if (selectedImages.length === 0) {
                showNotification('Please select images to crop', 'error');
                return;
            }

            if (!confirm('Crop ' + selectedImages.length + ' selected images with 5px padding (recommended)?')) {
                return;
            }

            startBulkCropToResults(5); // Always use 5px for bulk
        });

        // Save crop result as original
        $(document).on('click', '.save-crop-result', function () {
            if (isProcessing) {
                showNotification('Please wait for current operation to complete', 'warning');
                return;
            }

            let imageId = $(this).data('image-id');

            if (!confirm('Save this cropped version as the original image? This will replace the current image.')) {
                return;
            }

            saveCropResultAsOriginal(imageId, $(this));
        });

        // Discard crop result
        $(document).on('click', '.discard-crop-result', function () {
            let imageId = $(this).data('image-id');
            discardCropResult(imageId);
        });

        $('#toggle-detailed-log').on('click', function () {
            $('#progress-log').toggle();
        });
    }

    function updateBulkCropButtonText() {
        // Keep bulk button always 5px (recommended)
        $('#crop-selected').text('Crop Selected (5px)');
    }

    function cropImageToResults(imageId, padding, button) {
        isProcessing = true;
        button.prop('disabled', true).text('Cropping...');

        updateLiveProgress(0, 100, 'Creating cropped version...');
        $('#live-progress').show();

        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            timeout: 60000,
            data: {
                action: 'preview_crop', // Use preview_crop to not touch original
                image_id: imageId,
                padding: padding,
                nonce: ajax_object.nonce
            },
            success: function (response) {
                if (response.success) {
                    let data = response.data;
                    
                    // Add to results section
                    addCropResultToResults(imageId, data, padding);

                    button.text('Crop (' + padding + 'px)').removeClass('cropping');
                    updateLiveProgress(100, 100, 'Cropped version created');
                    showQuickResult('Cropped version created for image ' + imageId + ' (' + padding + 'px padding)');

                    setTimeout(function () {
                        $('#live-progress').fadeOut();
                    }, 2000);
                } else {
                    button.text('Crop Failed').addClass('failed');
                    updateLiveProgress(100, 100, 'Crop failed');
                    showQuickResult('Crop failed for image ' + imageId + ': ' + (response.data?.message || 'Unknown error'), true);
                }
            },
            error: function (xhr, status, error) {
                button.text('Error').addClass('failed');
                updateLiveProgress(100, 100, 'Error occurred');
                showQuickResult('Crop error for image ' + imageId + ': ' + error, true);
            },
            complete: function () {
                isProcessing = false;
                setTimeout(function () {
                    button.prop('disabled', false);
                    if (!button.hasClass('failed')) {
                        let currentPadding = parseInt(button.closest('.image-item').find('.padding-input').val()) || 5;
                        button.text('Crop (' + currentPadding + 'px)');
                    }
                }, 3000);
            }
        });
    }

    function startBulkCropToResults(padding) {
        isProcessing = true;
        $('#detailed-progress-section').show();
        $('#crop-selected').prop('disabled', true).text('Cropping...');

        updateLiveProgress(0, 100, 'Starting bulk crop...');
        $('#live-progress').show();

        let total = selectedImages.length;
        let completed = 0;
        let successCount = 0;
        let errorCount = 0;

        function processNext() {
            if (completed >= total) {
                completeBulkCropToResults(successCount, errorCount, total, padding);
                return;
            }

            let imageId = selectedImages[completed];
            let progress = completed + 1;

            updateDetailedProgress(progress, total, 'Cropping image ID: ' + imageId);
            updateLiveProgress(progress, total, 'Processing ' + progress + '/' + total);
            logProgress('Processing image ' + imageId + ' (' + progress + '/' + total + ')');

            $.ajax({
                url: ajax_object.ajax_url,
                type: 'POST',
                timeout: 60000,
                data: {
                    action: 'preview_crop',
                    image_id: imageId,
                    padding: padding,
                    nonce: ajax_object.nonce
                },
                success: function (response) {
                    if (response.success) {
                        successCount++;
                        addCropResultToResults(imageId, response.data, padding);
                        logProgress('Image ' + imageId + ' cropped successfully');
                    } else {
                        errorCount++;
                        logProgress('Image ' + imageId + ' failed: ' + (response.data?.message || 'Unknown error'), true);
                    }
                },
                error: function (xhr, status, error) {
                    errorCount++;
                    logProgress('Image ' + imageId + ' error: ' + error, true);
                },
                complete: function () {
                    completed++;
                    setTimeout(processNext, 500);
                }
            });
        }

        processNext();
    }

    function completeBulkCropToResults(successCount, errorCount, total, padding) {
        isProcessing = false;
        $('#crop-selected').prop('disabled', false).text('Crop Selected (5px)');

        updateDetailedProgress(total, total, 'Completed!');
        updateLiveProgress(100, 100, 'Bulk crop completed');

        logProgress('BULK CROP COMPLETED');
        logProgress('SUMMARY: ' + successCount + ' successful, ' + errorCount + ' failed out of ' + total + ' images (padding: ' + padding + 'px)');

        showQuickResult('Bulk crop completed: ' + successCount + '/' + total + ' images successful (' + padding + 'px padding)');

        setTimeout(function () {
            $('#live-progress').fadeOut();
        }, 5000);

        if (successCount === total) {
            showNotification('All ' + total + ' images cropped successfully!', 'success');
        } else if (successCount > 0) {
            showNotification(successCount + ' of ' + total + ' images cropped successfully', 'success');
        } else {
            showNotification('All crops failed. Check the detailed log for errors.', 'error');
        }
    }

    function saveCropResultAsOriginal(imageId, button) {
        isProcessing = true;
        button.prop('disabled', true).text('Saving...');

        updateLiveProgress(0, 100, 'Saving as original image...');
        $('#live-progress').show();

        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            timeout: 60000,
            data: {
                action: 'commit_preview',
                image_id: imageId,
                nonce: ajax_object.nonce
            },
            success: function (response) {
                if (response.success) {
                    // Remove from results section
                    $('.crop-result-item[data-image-id="' + imageId + '"]').fadeOut(500, function() {
                        $(this).remove();
                    });
                    
                    // Remove from main images section with animation
                    let imageItem = $('.image-item[data-image-id="' + imageId + '"]');
                    imageItem.addClass('removing');
                    
                    setTimeout(function() {
                        imageItem.remove();
                        
                        // Update selected arrays
                        selectedImages = selectedImages.filter(id => id !== imageId);
                        updateSelectedImagesDisplay();
                        
                        // Check if image checkbox was checked and update
                        let checkbox = $('#img_' + imageId);
                        if (checkbox.is(':checked')) {
                            checkbox.prop('checked', false);
                        }
                        
                        showNotification('Image ' + imageId + ' saved and removed from list ✅', 'success');
                    }, 500);

                    button.text('Saved').addClass('success');
                    updateLiveProgress(100, 100, 'Image saved successfully');
                    showQuickResult('Image ' + imageId + ' saved as original and removed from workflow');

                    setTimeout(function () {
                        $('#live-progress').fadeOut();
                    }, 2000);
                } else {
                    button.text('Save Failed').addClass('failed');
                    updateLiveProgress(100, 100, 'Save failed');
                    showQuickResult('Save failed for image ' + imageId + ': ' + (response.data?.message || 'Unknown error'), true);
                }
            },
            error: function (xhr, status, error) {
                button.text('Error').addClass('failed');
                updateLiveProgress(100, 100, 'Error occurred');
                showQuickResult('Save error for image ' + imageId + ': ' + error, true);
            },
            complete: function () {
                isProcessing = false;
                setTimeout(function () {
                    button.prop('disabled', false);
                    if (!button.hasClass('success') && !button.hasClass('failed')) {
                        button.text('Save');
                    }
                }, 3000);
            }
        });
    }

    function discardCropResult(imageId) {
        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            data: {
                action: 'discard_preview',
                image_id: imageId,
                nonce: ajax_object.nonce
            },
            success: function (response) {
                $('.crop-result-item[data-image-id="' + imageId + '"]').fadeOut(500, function() {
                    $(this).remove();
                });
                showNotification('Cropped result discarded', 'success');
            }
        });
    }

    function addCropResultToResults(imageId, previewData, padding) {
        $('#cropped-images-section').show();

        let imageItem = $('.image-item[data-image-id="' + imageId + '"]');
        let imageTitle = imageItem.find('.image-title').text() || 'Image ' + imageId;
        let productName = imageItem.closest('.product-images-group').find('.product-group-title').text() || 'Unknown Product';

        // Remove existing result for this image if exists
        $('.crop-result-item[data-image-id="' + imageId + '"]').remove();

        let html = '<div class="crop-result-item" data-image-id="' + imageId + '">';
        html += '<div class="crop-result-preview">';
        html += '<img src="' + previewData.preview_url + '" alt="Cropped ' + imageTitle + '" loading="lazy">';
        html += '</div>';
        html += '<div class="crop-result-info">';
        html += '<h4 title="' + imageTitle + '">' + imageTitle + '</h4>';
        html += '<div class="crop-result-meta">Product: ' + productName + '</div>';
        html += '<div class="crop-result-meta">ID: ' + imageId + '</div>';
        html += '<div class="crop-result-meta">Size: ' + previewData.preview_size + '</div>';
        html += '<div class="crop-result-meta">Padding: ' + padding + 'px</div>';
        html += '<div class="crop-result-actions">';
        html += '<button class="button button-primary save-crop-result" data-image-id="' + imageId + '">Save as Original</button>';
        html += '<button class="button button-secondary discard-crop-result" data-image-id="' + imageId + '">Discard</button>';
        html += '<a href="' + previewData.preview_url + '" target="_blank" class="button button-small">View Full</a>';
        html += '</div>';
        html += '</div>';
        html += '</div>';

        $('#cropped-images-grid').prepend(html);
    }

    // Keep all other existing functions (resetPluginState, updateCategoryInfo, loadCategories, etc.)
    // ... [Previous functions remain unchanged] ...

    function resetPluginState() {
        clearTimeout(window.searchTimeout);

        selectedImages = [];
        selectedProducts = [];
        currentCategory = '';
        currentSearchTerm = '';
        currentPage = 1;
        totalPages = 1;
        isProcessing = false;

        $('#category-select').val('');
        $('#search-products').val('');
        $('#clear-search').hide();
        $('#load-category-products').prop('disabled', true);
        $('#category-info').html('');
        $('#products-grid').html('');
        $('#images-grid').html('');
        $('#selected-products-preview').html('');
        $('#cropped-images-grid').html('');
        $('.selected-summary').hide();
        $('#detailed-progress-section').hide();
        $('#cropped-images-section').hide();
        $('#live-progress').hide();
        $('#quick-results').hide();

        $('#product-count').text('');
        $('#page-info').text('Page 1 of 1');
        $('#selected-products-count').text('0 selected');
        $('#selected-count').text('0 selected');

        updateSelectedProductsDisplay();
        updateSelectedImagesDisplay();
        updatePaginationButtons();

        showNotification('Plugin reset successfully', 'success');
    }

    function updateCategoryInfo() {
        if (currentCategory) {
            let categoryName = $('#category-select option:selected').text();
            $('#category-info').html('<p>Selected: <strong>' + categoryName + '</strong></p>');
        } else {
            $('#category-info').html('');
        }
    }

    function loadCategories() {
        $('#category-select').html('<option value="">Loading categories...</option>');

        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            timeout: 30000,
            data: {
                action: 'get_product_categories',
                nonce: ajax_object.nonce
            },
            success: function (response) {
                if (response.success) {
                    displayCategories(response.data);
                } else {
                    $('#category-select').html('<option value="">Failed to load categories</option>');
                    showNotification('Failed to load categories', 'error');
                }
            },
            error: function (xhr, status, error) {
                $('#category-select').html('<option value="">Error loading categories</option>');
                showNotification('Error loading categories: ' + error, 'error');
            }
        });
    }

    function displayCategories(categories) {
        let html = '<option value="">Select a category...</option>';

        categories.forEach(function (category) {
            let countText = category.id === 'all' ? '' : ' (' + category.count + ')';
            html += '<option value="' + category.id + '">' + category.name + countText + '</option>';
        });

        $('#category-select').html(html);
    }

    function loadCategoryProducts() {
        if (!currentCategory && !currentSearchTerm) return;

        isProcessing = true;
        updateLiveProgress(0, 100, 'Loading products...');
        $('#live-progress').show();
        $('#products-grid').html('<div class="loading">Loading products...</div>');

        let ajaxData = {
            action: 'get_products_by_category',
            category_id: currentCategory,
            page: currentPage,
            per_page: perPage,
            nonce: ajax_object.nonce
        };

        if (currentSearchTerm) {
            ajaxData.search_term = currentSearchTerm;
        }

        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            timeout: 60000,
            data: ajaxData,
            success: function (response) {
                if (response.success) {
                    displayProducts(response.data.products);
                    updatePagination(response.data.pagination);
                    updateLiveProgress(100, 100, 'Products loaded successfully');

                    setTimeout(function () {
                        $('#live-progress').fadeOut();
                    }, 2000);
                } else {
                    $('#products-grid').html('<div class="error">Failed to load products</div>');
                    showNotification('Failed to load products', 'error');
                }
            },
            error: function (xhr, status, error) {
                $('#products-grid').html('<div class="error">Error loading products: ' + error + '</div>');
                showNotification('Error loading products: ' + error, 'error');
            },
            complete: function () {
                isProcessing = false;
                updatePaginationButtons();
            }
        });
    }

    function displayProducts(products) {
        if (products.length === 0) {
            let message = currentSearchTerm ?
                'No products found for search "' + currentSearchTerm + '"' :
                'No products found in this category.';
            $('#products-grid').html('<div class="no-products">' + message + '</div>');
            return;
        }

        let html = '<div class="products-container">';

        products.forEach(function (product) {
            let isSelected = selectedProducts.indexOf(product.id) !== -1;
            let checkedAttr = isSelected ? 'checked' : '';
            let selectedClass = isSelected ? 'selected' : '';

            let highlightedTitle = product.title;
            if (currentSearchTerm) {
                let regex = new RegExp('(' + currentSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
                highlightedTitle = product.title.replace(regex, '<mark style="background: #ffeb3b; padding: 1px 2px;">$1</mark>');
            }

            html += '<div class="product-card ' + selectedClass + '" data-product-id="' + product.id + '">';
            html += '<div class="product-checkbox-container">';
            html += '<input type="checkbox" class="product-checkbox" value="' + product.id + '" ' + checkedAttr + '>';
            html += '</div>';
            html += '<div class="product-thumbnail">';
            if (product.thumbnail_url) {
                html += '<img src="' + product.thumbnail_url + '" alt="Product thumbnail">';
            } else {
                html += '<div class="no-image">No Image</div>';
            }
            html += '</div>';
            html += '<div class="product-info">';
            html += '<h3 title="' + product.title + '">' + highlightedTitle + '</h3>';
            html += '<div class="product-meta">ID: ' + product.id + ' | ' + product.type_label + ' | ' + product.image_count + ' images</div>';
            if (product.price) {
                html += '<div class="product-price">' + product.price + '</div>';
            }
            html += '</div>';
            html += '</div>';
        });

        html += '</div>';
        $('#products-grid').html(html);
    }

    function updatePagination(pagination) {
        totalPages = pagination.total_pages;
        currentPage = pagination.current_page;

        let pageInfo = 'Page ' + currentPage + ' of ' + totalPages;
        $('#page-info').text(pageInfo);
        $('#product-count').text('(' + pagination.showing + ' of ' + pagination.total_products + ')');
    }

    function updatePaginationButtons() {
        let prevDisabled = currentPage <= 1 || isProcessing;
        let nextDisabled = currentPage >= totalPages || isProcessing;

        $('#prev-page').prop('disabled', prevDisabled);
        $('#next-page').prop('disabled', nextDisabled);
    }

    function updateSelectedProductsDisplay() {
        let count = selectedProducts.length;
        $('#selected-products-count').text(count + ' products selected');
        $('#load-all-selected-images').prop('disabled', count === 0);
        $('#clear-selection').prop('disabled', count === 0);

        if (count > 0) {
            $('.selected-summary').show();
            displaySelectedProductsPreview();
        } else {
            $('.selected-summary').hide();
        }
    }

    function displaySelectedProductsPreview() {
        let html = '';

        selectedProducts.slice(0, 10).forEach(function (productId) {
            let productCard = $('.product-card[data-product-id="' + productId + '"]');
            if (productCard.length) {
                let productTitle = productCard.find('h3').attr('title') || productCard.find('h3').text();
                let imageCount = productCard.find('.product-meta').text().match(/(\d+) images/);
                let count = imageCount ? imageCount[1] : '0';

                html += '<span class="selected-product-tag" title="' + productTitle + '">' +
                    productTitle.substring(0, 20) + (productTitle.length > 20 ? '...' : '') +
                    ' (' + count + ')</span>';
            }
        });

        if (selectedProducts.length > 10) {
            html += '<span class="selected-product-tag">+' + (selectedProducts.length - 10) + ' more...</span>';
        }

        $('#selected-products-preview').html(html);
    }

    function clearAllSelections() {
        selectedProducts = [];
        selectedImages = [];
        $('.product-checkbox').prop('checked', false);
        $('.product-card').removeClass('selected');
        $('.image-checkbox').prop('checked', false);
        $('#images-grid').html('');
        $('.selected-summary').hide();
        updateSelectedProductsDisplay();
        updateSelectedImagesDisplay();

        showNotification('All selections cleared', 'success');
    }

    function loadSelectedProductsImages() {
        if (selectedProducts.length === 0) return;

        isProcessing = true;
        updateLiveProgress(0, 100, 'Loading images...');
        $('#live-progress').show();

        $('#images-grid').html('<div class="loading">Loading images for ' + selectedProducts.length + ' products...</div>');
        selectedImages = [];
        updateSelectedImagesDisplay();

        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            timeout: 120000,
            data: {
                action: 'get_product_images',
                product_ids: selectedProducts,
                nonce: ajax_object.nonce
            },
            success: function (response) {
                if (response.success) {
                    displayImages(response.data.images, response.data);
                    updateLiveProgress(100, 100, 'Images loaded successfully');

                    setTimeout(function () {
                        $('#live-progress').fadeOut();
                    }, 2000);
                } else {
                    $('#images-grid').html('<div class="error">Failed to load images</div>');
                    showNotification('Failed to load images', 'error');
                }
            },
            error: function (xhr, status, error) {
                $('#images-grid').html('<div class="error">Error loading images: ' + error + '</div>');
                showNotification('Error loading images: ' + error, 'error');
            },
            complete: function () {
                isProcessing = false;
            }
        });
    }

    function displayImages(images, data) {
        if (images.length === 0) {
            $('#images-grid').html('<div class="no-images">No images found for selected products.</div>');
            return;
        }

        let html = '<div class="images-info">';
        html += '<strong>Total Images:</strong> ' + data.total_images + ' from ' + data.products_count + ' products';
        html += '</div>';

        let imagesByProduct = {};
        images.forEach(function (image) {
            if (!imagesByProduct[image.product_id]) {
                imagesByProduct[image.product_id] = [];
            }
            imagesByProduct[image.product_id].push(image);
        });

        Object.keys(imagesByProduct).forEach(function (productId) {
            let productImages = imagesByProduct[productId];
            let productName = productImages[0].product_name;

            html += '<div class="product-images-group">';
            html += '<div class="product-group-title">' + productName + ' (' + productImages.length + ' images)</div>';
            html += '<div class="product-images-grid">';

            productImages.forEach(function (image) {
                html += '<div class="image-item" data-image-id="' + image.id + '">';
                html += '<div class="image-checkbox-container">';
                html += '<input type="checkbox" class="image-checkbox" id="img_' + image.id + '" value="' + image.id + '">';
                html += '<label for="img_' + image.id + '">Select</label>';
                html += '</div>';
                html += '<div class="image-preview">';
                html += '<img src="' + image.url + '" alt="' + image.title + '" loading="lazy">';
                if (image.badge) {
                    html += '<div class="image-badge ' + image.badge.toLowerCase() + '">' + image.badge + '</div>';
                }
                html += '</div>';
                html += '<div class="image-info">';
                html += '<div class="image-title" title="' + image.title + '">' + image.title + '</div>';
                html += '<p><strong>ID:</strong> ' + image.id + '</p>';
                html += '<p><strong>Size:</strong> ' + image.size + '</p>';

                // Individual padding control
                html += '<div class="individual-padding">';
                html += '<label>Padding: </label>';
                html += '<input type="number" class="padding-input" value="5" min="0" max="100" style="width:50px;"> px';
                html += '</div>';

                html += '<div class="image-actions">';
                html += '<button class="button button-small crop-individual" data-image-id="' + image.id + '">Crop (5px)</button>';
                html += '<a href="' + image.full_url + '" target="_blank" class="button button-small">View Original</a>';
                html += '</div>';

                html += '</div>';
                html += '</div>';
            });

            html += '</div>';
            html += '</div>';
        });

        $('#images-grid').html(html);
    }

    function updateSelectedImagesDisplay() {
        let count = selectedImages.length;
        $('#selected-count').text(count + ' selected');
        $('#crop-selected').prop('disabled', count === 0 || isProcessing);
        
        // Keep bulk crop button text fixed at 5px
        $('#crop-selected').text('Crop Selected (5px)');
    }

    function updateLiveProgress(current, total, message) {
        let percentage = total > 0 ? (current / total) * 100 : 0;
        $('#mini-progress-fill').css('width', percentage + '%');
        $('#mini-progress-text').text(message);
    }

    function updateDetailedProgress(current, total, message) {
        let percentage = total > 0 ? (current / total) * 100 : 0;
        $('#progress-fill').css('width', percentage + '%');
        $('#progress-text').text(current + ' / ' + total + ' - ' + message);
    }

    function logProgress(message, isError = false) {
        let timestamp = new Date().toLocaleTimeString();
        let currentLog = $('#progress-log').html();
        let logClass = isError ? 'style="color: #d63638;"' : '';
        $('#progress-log').html('[' + timestamp + '] <span ' + logClass + '>' + message + '</span><br>' + currentLog);
    }

    function showQuickResult(message, isError = false) {
        $('#quick-results').show();
        let currentContent = $('#quick-results-content').html();
        let timestamp = new Date().toLocaleTimeString();
        let resultClass = isError ? 'style="color: #d63638;"' : 'style="color: #00a32a;"';

        $('#quick-results-content').html(
            '[' + timestamp + '] <span ' + resultClass + '>' + message + '</span><br>' +
            currentContent
        );

        let lines = $('#quick-results-content').html().split('<br>');
        if (lines.length > 5) {
            $('#quick-results-content').html(lines.slice(0, 5).join('<br>'));
        }
    }

    function showNotification(message, type) {
        $('.notification').remove();

        let notification = $('<div class="notification ' + type + '">' + message + '</div>');
        $('body').append(notification);

        notification.fadeIn(300).delay(type === 'error' ? 8000 : 5000).fadeOut(500, function () {
            $(this).remove();
        });
    }
});