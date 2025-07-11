jQuery(document).ready(function ($) {
    let selectedImages = [];
    let selectedProducts = [];
    let currentCategory = '';
    let currentPage = 1;
    let totalPages = 1;
    let perPage = 50;
    let isProcessing = false;
    let croppedImages = [];
    let currentSearchTerm = '';
    let imagePreviews = {};

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

        // PREVIEW CROP (ne diramo original)
        $(document).on('click', '.preview-crop', function () {
            if (isProcessing) {
                showNotification('Please wait for current operation to complete', 'warning');
                return;
            }

            let imageId = $(this).data('image-id');
            let paddingInput = $(this).closest('.image-item').find('.padding-input');
            let padding = parseInt(paddingInput.val()) || 10;

            previewCropImage(imageId, padding, $(this));
        });

        // COMMIT PREVIEW (sacuvaj kao original)
        $(document).on('click', '.commit-preview', function () {
            if (isProcessing) {
                showNotification('Please wait for current operation to complete', 'warning');
                return;
            }

            let imageId = $(this).data('image-id');

            if (!confirm('Save this preview as the final cropped image? This will replace the original.')) {
                return;
            }

            commitPreview(imageId, $(this));
        });

        // DISCARD PREVIEW (obriši preview)
        $(document).on('click', '.discard-preview', function () {
            let imageId = $(this).data('image-id');
            discardPreview(imageId);
        });

        // AUTO-PREVIEW sa debounce
        $(document).on('input', '.padding-input', function () {
            let imageId = $(this).closest('.image-item').data('image-id');
            let padding = parseInt($(this).val()) || 10;

            clearTimeout(window.paddingTimeout);
            window.paddingTimeout = setTimeout(function () {
                let previewBtn = $('.image-item[data-image-id="' + imageId + '"] .preview-crop');
                if (previewBtn.length && !isProcessing) {
                    previewCropImage(imageId, padding, previewBtn);
                }
            }, 800);
        });

        // Standard cropping
        $(document).on('click', '.crop-single', function () {
            if (isProcessing) {
                showNotification('Please wait for current operation to complete', 'warning');
                return;
            }

            let imageId = $(this).data('image-id');
            cropSingleImage(imageId, $(this));
        });

        $('#crop-selected').on('click', function () {
            if (isProcessing) {
                showNotification('Please wait for current operation to complete', 'warning');
                return;
            }

            if (selectedImages.length === 0) {
                showNotification('Please select images to crop', 'error');
                return;
            }

            if (!confirm('Crop ' + selectedImages.length + ' selected images with 5px padding?')) {
                return;
            }

            startBulkCrop();
        });

        $('#crop-with-padding').on('click', function () {
            if (isProcessing) {
                showNotification('Please wait for current operation to complete', 'warning');
                return;
            }

            if (selectedImages.length === 0) {
                showNotification('Please select images to crop', 'error');
                return;
            }

            let padding = parseInt($('#padding-input').val()) || 10;
            if (padding < 0 || padding > 100) {
                showNotification('Padding must be between 0-100px', 'error');
                return;
            }

            if (!confirm('Crop ' + selectedImages.length + ' images with ' + padding + 'px padding?')) {
                return;
            }

            startBulkCropWithPadding(padding);
        });

        // Restore
        $(document).on('click', '.restore-backup', function () {
            if (isProcessing) {
                showNotification('Please wait for current operation to complete', 'warning');
                return;
            }

            let imageId = $(this).data('image-id');
            if (!confirm('Restore image ' + imageId + ' from backup?')) {
                return;
            }

            restoreImageFromBackup(imageId, $(this));
        });

        $('#toggle-detailed-log').on('click', function () {
            $('#progress-log').toggle();
        });
    }

    function resetPluginState() {
        clearTimeout(window.searchTimeout);

        selectedImages = [];
        selectedProducts = [];
        currentCategory = '';
        currentSearchTerm = '';
        currentPage = 1;
        totalPages = 1;
        isProcessing = false;
        croppedImages = [];
        imagePreviews = {};

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
        imagePreviews = {};
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
                html += '<input type="number" class="padding-input" value="10" min="0" max="100" style="width:50px;"> px';
                html += '</div>';

                html += '<div class="image-actions">';
                html += '<button class="button button-small preview-crop" data-image-id="' + image.id + '">Preview</button>';
                html += '<button class="button button-small crop-with-custom-padding" data-image-id="' + image.id + '">Crop</button>';
                html += '<button class="button button-small crop-single" data-image-id="' + image.id + '">Quick Crop (5px)</button>';
                html += '<a href="' + image.full_url + '" target="_blank" class="button button-small">View</a>';
                html += '</div>';

                // Preview container (hidden initially)
                html += '<div class="preview-container" style="display: none;"></div>';

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
        $('#crop-with-padding').prop('disabled', count === 0 || isProcessing);
    }

    // CROP IMAGE WITH PADDING (kropi i pošalji u results, ne diraj original)
    function cropImageWithPadding(imageId, padding, button) {
        isProcessing = true;
        button.prop('disabled', true).text('Cropping...');

        updateLiveProgress(0, 100, 'Creating cropped version...');
        $('#live-progress').show();

        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            timeout: 60000,
            data: {
                action: 'preview_crop', // Koristimo preview_crop da ne diramo original
                image_id: imageId,
                padding: padding,
                nonce: ajax_object.nonce
            },
            success: function (response) {
                if (response.success) {
                    let data = response.data;
                    
                    // Dodaj u results sekciju
                    addCropResultToResults(imageId, data, padding);

                    button.text('Cropped').addClass('success');
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
                    if (!button.hasClass('success') && !button.hasClass('failed')) {
                        button.text('Crop');
                    }
                }, 3000);
            }
        });
    }

    // SAVE RESULT AS ORIGINAL (sacuvaj kao finalnu sliku)
    function saveResultAsOriginal(imageId, button) {
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
                    // Ukloni iz results
                    $('.cropped-result-item[data-image-id="' + imageId + '"]').fadeOut(500, function() {
                        $(this).remove();
                    });
                    
                    // Refresh original sliku
                    refreshImagePreview(imageId);

                    button.text('Saved').addClass('success');
                    updateLiveProgress(100, 100, 'Image saved successfully');
                    showQuickResult('Image ' + imageId + ' saved as original');

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

    // DISCARD RESULT (ukloni iz results)
    function discardResult(imageId) {
        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            data: {
                action: 'discard_preview',
                image_id: imageId,
                nonce: ajax_object.nonce
            },
            success: function (response) {
                $('.cropped-result-item[data-image-id="' + imageId + '"]').fadeOut(500, function() {
                    $(this).remove();
                });
                showNotification('Cropped result discarded', 'success');
            }
        });
    }

    // DODAJ CROP RESULT U RESULTS SEKCIJU
    function addCropResultToResults(imageId, previewData, padding) {
        $('#cropped-images-section').show();

        let imageItem = $('.image-item[data-image-id="' + imageId + '"]');
        let imageTitle = imageItem.find('.image-title').text() || 'Image ' + imageId;
        let productName = imageItem.closest('.product-images-group').find('.product-group-title').text() || 'Unknown Product';

        // Ukloni postojeći result za ovu sliku ako postoji
        $('.cropped-result-item[data-image-id="' + imageId + '"]').remove();

        let html = '<div class="cropped-result-item" data-image-id="' + imageId + '">';
        html += '<div class="cropped-image-preview">';
        html += '<img src="' + previewData.preview_url + '" alt="Cropped ' + imageTitle + '" loading="lazy">';
        html += '</div>';
        html += '<div class="cropped-image-info">';
        html += '<h4 title="' + imageTitle + '">' + imageTitle + '</h4>';
        html += '<div class="cropped-image-meta">Product: ' + productName + '</div>';
        html += '<div class="cropped-image-meta">ID: ' + imageId + '</div>';
        html += '<div class="cropped-image-meta">Size: ' + previewData.preview_size + '</div>';
        html += '<div class="cropped-image-meta">Padding: ' + padding + 'px</div>';
        html += '<div class="cropped-image-actions">';
        html += '<button class="button button-primary save-result" data-image-id="' + imageId + '">Save as Original</button>';
        html += '<button class="button button-secondary discard-result" data-image-id="' + imageId + '">Discard</button>';
        html += '<a href="' + previewData.preview_url + '" target="_blank" class="button button-small">View Full</a>';
        html += '</div>';
        html += '</div>';
        html += '</div>';

        $('#cropped-images-grid').prepend(html);
    }
    function previewCropImage(imageId, padding, button) {
        isProcessing = true;
        button.prop('disabled', true).text('Creating Preview...');

        updateLiveProgress(0, 100, 'Creating crop preview...');
        $('#live-progress').show();

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
                    let data = response.data;
                    imagePreviews[imageId] = data;
                    updateImagePreview(imageId, data);

                    button.text('Preview Created').addClass('success');
                    updateLiveProgress(100, 100, 'Preview created successfully');
                    showQuickResult('Preview created for image ' + imageId + ' (' + padding + 'px padding)');

                    setTimeout(function () {
                        $('#live-progress').fadeOut();
                    }, 2000);
                } else {
                    button.text('Preview Failed').addClass('failed');
                    updateLiveProgress(100, 100, 'Preview failed');
                    showQuickResult('Preview failed for image ' + imageId + ': ' + (response.data?.message || 'Unknown error'), true);
                }
            },
            error: function (xhr, status, error) {
                button.text('Error').addClass('failed');
                updateLiveProgress(100, 100, 'Error occurred');
                showQuickResult('Preview error for image ' + imageId + ': ' + error, true);
            },
            complete: function () {
                isProcessing = false;
                setTimeout(function () {
                    button.prop('disabled', false);
                    if (!button.hasClass('success') && !button.hasClass('failed')) {
                        button.text('Preview');
                    }
                }, 3000);
            }
        });
    }

    // COMMIT PREVIEW FUNKCIJA
    function commitPreview(imageId, button) {
        if (!imagePreviews[imageId]) {
            showNotification('No preview to commit', 'error');
            return;
        }

        isProcessing = true;
        button.prop('disabled', true).text('Saving...');

        updateLiveProgress(0, 100, 'Saving cropped image...');
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
                    delete imagePreviews[imageId];
                    refreshImagePreview(imageId);
                    hidePreviewUI(imageId);

                    button.text('Saved').addClass('success');
                    updateLiveProgress(100, 100, 'Image saved successfully');
                    showQuickResult('Image ' + imageId + ' saved successfully');

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

    // DISCARD PREVIEW FUNKCIJA
    function discardPreview(imageId) {
        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            data: {
                action: 'discard_preview',
                image_id: imageId,
                nonce: ajax_object.nonce
            },
            success: function (response) {
                delete imagePreviews[imageId];
                hidePreviewUI(imageId);
                showNotification('Preview discarded', 'success');
            }
        });
    }

    // AŽURIRAJ IMAGE PREVIEW UI
    function updateImagePreview(imageId, previewData) {
        let imageItem = $('.image-item[data-image-id="' + imageId + '"]');
        let previewContainer = imageItem.find('.preview-container');

        let previewHtml = '<div class="crop-preview">';
        previewHtml += '<div class="preview-header">Crop Preview (' + previewData.padding_used + 'px padding)</div>';
        previewHtml += '<div class="preview-image">';
        previewHtml += '<img src="' + previewData.preview_url + '" alt="Crop Preview" style="max-width: 100%; height: auto; border: 2px solid #0073aa;">';
        previewHtml += '</div>';
        previewHtml += '<div class="preview-info">Size: ' + previewData.preview_size + '</div>';
        previewHtml += '<div class="preview-actions">';
        previewHtml += '<button class="button button-primary commit-preview" data-image-id="' + imageId + '">Save This Crop</button>';
        previewHtml += '<button class="button button-secondary discard-preview" data-image-id="' + imageId + '">Try Again</button>';
        previewHtml += '</div>';
        previewHtml += '</div>';

        previewContainer.html(previewHtml);
        previewContainer.show();
        imageItem.addClass('has-preview');
    }

    // UKLONI PREVIEW UI
    function hidePreviewUI(imageId) {
        let imageItem = $('.image-item[data-image-id="' + imageId + '"]');
        imageItem.find('.preview-container').hide().html('');
        imageItem.removeClass('has-preview');
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

    function cropSingleImage(imageId, button) {
        isProcessing = true;
        button.prop('disabled', true).text('Cropping...');

        updateLiveProgress(0, 100, 'Cropping image ' + imageId + '...');
        $('#live-progress').show();

        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            timeout: 60000,
            data: {
                action: 'crop_single_image',
                image_id: imageId,
                nonce: ajax_object.nonce
            },
            success: function (response) {
                if (response.success) {
                    button.text('Cropped').addClass('cropped');
                    updateLiveProgress(100, 100, 'Image cropped successfully');
                    showQuickResult('Image ' + imageId + ' cropped successfully');
                    refreshImagePreview(imageId);
                    addCroppedImageToResults(response.data);

                    setTimeout(function () {
                        $('#live-progress').fadeOut();
                    }, 2000);
                } else {
                    button.text('Failed').addClass('failed');
                    updateLiveProgress(100, 100, 'Crop failed');
                    showQuickResult('Image ' + imageId + ' failed: ' + (response.data?.message || 'Unknown error'), true);
                }
            },
            error: function (xhr, status, error) {
                button.text('Error').addClass('failed');
                updateLiveProgress(100, 100, 'Error occurred');
                showQuickResult('Image ' + imageId + ' error: ' + error, true);
            },
            complete: function () {
                isProcessing = false;
                setTimeout(function () {
                    button.prop('disabled', false);
                    if (!button.hasClass('cropped') && !button.hasClass('failed')) {
                        button.text('Quick Crop');
                    }
                }, 3000);
            }
        });
    }

    function startBulkCrop() {
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
                completeBulkCrop(successCount, errorCount, total);
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
                    action: 'crop_single_image',
                    image_id: imageId,
                    nonce: ajax_object.nonce
                },
                success: function (response) {
                    if (response.success) {
                        successCount++;
                        refreshImagePreview(imageId);
                        logProgress('Image ' + imageId + ' cropped successfully');
                        addCroppedImageToResults(response.data);
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

    function startBulkCropWithPadding(padding) {
        isProcessing = true;
        $('#detailed-progress-section').show();
        $('#crop-with-padding').prop('disabled', true).text('Cropping with ' + padding + 'px...');

        updateLiveProgress(0, 100, 'Starting bulk crop with ' + padding + 'px padding...');
        $('#live-progress').show();

        let total = selectedImages.length;
        let completed = 0;
        let successCount = 0;
        let errorCount = 0;

        function processNext() {
            if (completed >= total) {
                completeBulkCropWithPadding(successCount, errorCount, total, padding);
                return;
            }

            let imageId = selectedImages[completed];
            let progress = completed + 1;

            updateDetailedProgress(progress, total, 'Cropping image ID: ' + imageId + ' (padding: ' + padding + 'px)');
            updateLiveProgress(progress, total, 'Processing ' + progress + '/' + total);
            logProgress('Processing image ' + imageId + ' with ' + padding + 'px padding (' + progress + '/' + total + ')');

            $.ajax({
                url: ajax_object.ajax_url,
                type: 'POST',
                timeout: 60000,
                data: {
                    action: 'crop_with_padding',
                    image_id: imageId,
                    padding: padding,
                    nonce: ajax_object.nonce
                },
                success: function (response) {
                    if (response.success) {
                        successCount++;
                        refreshImagePreview(imageId);
                        logProgress('Image ' + imageId + ' cropped successfully with ' + padding + 'px padding');
                        addCroppedImageToResults(response.data);
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

    function completeBulkCrop(successCount, errorCount, total) {
        isProcessing = false;
        $('#crop-selected').prop('disabled', false).text('🚀 Brzi Crop (5px)');

        updateDetailedProgress(total, total, 'Completed!');
        updateLiveProgress(100, 100, 'Bulk crop completed');

        logProgress('BULK CROP COMPLETED');
        logProgress('SUMMARY: ' + successCount + ' successful, ' + errorCount + ' failed out of ' + total + ' images');

        showQuickResult('Bulk crop completed: ' + successCount + '/' + total + ' images successful');

        if (successCount > 0) {
            selectedImages = [];
            $('.image-checkbox').prop('checked', false);
            updateSelectedImagesDisplay();
        }

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

    function completeBulkCropWithPadding(successCount, errorCount, total, padding) {
        isProcessing = false;
        $('#crop-with-padding').prop('disabled', false).text('🎯 Crop sa Padding');

        updateDetailedProgress(total, total, 'Completed!');
        updateLiveProgress(100, 100, 'Bulk crop with ' + padding + 'px padding completed');

        logProgress('BULK CROP WITH PADDING COMPLETED');
        logProgress('SUMMARY: ' + successCount + ' successful, ' + errorCount + ' failed out of ' + total + ' images (padding: ' + padding + 'px)');

        showQuickResult('Bulk crop completed: ' + successCount + '/' + total + ' images successful (' + padding + 'px padding)');

        if (successCount > 0) {
            selectedImages = [];
            $('.image-checkbox').prop('checked', false);
            updateSelectedImagesDisplay();
        }

        setTimeout(function () {
            $('#live-progress').fadeOut();
        }, 5000);

        if (successCount === total) {
            showNotification('All ' + total + ' images cropped successfully with ' + padding + 'px padding!', 'success');
        } else if (successCount > 0) {
            showNotification(successCount + ' of ' + total + ' images cropped successfully', 'success');
        } else {
            showNotification('All crops failed. Check the detailed log for errors.', 'error');
        }
    }

    function restoreImageFromBackup(imageId, button) {
        isProcessing = true;
        button.prop('disabled', true).text('Restoring...');

        updateLiveProgress(0, 100, 'Restoring image ' + imageId + ' from backup...');
        $('#live-progress').show();

        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            timeout: 60000,
            data: {
                action: 'restore_image_backup',
                image_id: imageId,
                nonce: ajax_object.nonce
            },
            success: function (response) {
                if (response.success) {
                    button.text('Restored').addClass('cropped');
                    updateLiveProgress(100, 100, 'Image restored successfully');
                    showQuickResult('Image ' + imageId + ' restored from backup');
                    refreshImagePreview(imageId);

                    setTimeout(function () {
                        $('#live-progress').fadeOut();
                    }, 2000);
                } else {
                    button.text('Failed').addClass('failed');
                    updateLiveProgress(100, 100, 'Restore failed');
                    showQuickResult('Image ' + imageId + ' restore failed: ' + (response.data?.message || 'Unknown error'), true);
                }
            },
            error: function (xhr, status, error) {
                button.text('Error').addClass('failed');
                updateLiveProgress(100, 100, 'Error occurred');
                showQuickResult('Image ' + imageId + ' restore error: ' + error, true);
            },
            complete: function () {
                isProcessing = false;
                setTimeout(function () {
                    button.prop('disabled', false);
                    if (!button.hasClass('cropped') && !button.hasClass('failed')) {
                        button.text('Restore');
                    }
                }, 3000);
            }
        });
    }

    function addCroppedImageToResults(data) {
        // Ova funkcija se koristi samo za quick crop i bulk crop
        $('#cropped-images-section').show();
        croppedImages.push(data);

        let imageItem = $('.image-item[data-image-id="' + data.image_id + '"]');
        let imageTitle = imageItem.find('.image-title').text() || 'Image ' + data.image_id;
        let productName = imageItem.closest('.product-images-group').find('.product-group-title').text() || 'Unknown Product';

        let html = '<div class="cropped-image-item saved-crop" data-image-id="' + data.image_id + '">';
        html += '<div class="cropped-image-preview">';
        html += '<img src="' + (data.cropped_url || '') + '" alt="Cropped ' + imageTitle + '" loading="lazy">';
        html += '</div>';
        html += '<div class="cropped-image-info">';
        html += '<h4 title="' + imageTitle + '">✅ ' + imageTitle + ' (SAVED)</h4>';
        html += '<div class="cropped-image-meta">Product: ' + productName + '</div>';
        html += '<div class="cropped-image-meta">ID: ' + data.image_id + '</div>';
        if (data.new_size) {
            html += '<div class="cropped-image-meta">New Size: ' + data.new_size + '</div>';
        }
        if (data.padding_used) {
            html += '<div class="cropped-image-meta">Padding: ' + data.padding_used + 'px</div>';
        }
        html += '<div class="cropped-image-actions">';
        html += '<a href="' + (data.cropped_url || '') + '" target="_blank" class="button button-small">View Full</a>';
        html += '<span style="color: #00a32a; font-weight: bold;">✓ Saved as Original</span>';
        html += '</div>';
        html += '</div>';
        html += '</div>';

        $('#cropped-images-grid').prepend(html);
    }

    function refreshImagePreview(imageId) {
        let imageItem = $('.image-item[data-image-id="' + imageId + '"]');
        let img = imageItem.find('img');
        let currentSrc = img.attr('src');

        if (currentSrc) {
            let newSrc = currentSrc.split('?')[0] + '?v=' + Date.now();
            img.attr('src', newSrc);

            let viewLink = imageItem.find('a[target="_blank"]');
            if (viewLink.length) {
                let currentHref = viewLink.attr('href');
                if (currentHref) {
                    let newHref = currentHref.split('?')[0] + '?v=' + Date.now();
                    viewLink.attr('href', newHref);
                }
            }
        }
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